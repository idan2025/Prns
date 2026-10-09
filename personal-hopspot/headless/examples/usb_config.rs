//! Configure a screenless nRF52840 Hopspot over USB with Remote Control.
//!
//! `provision` merges the firmware UF2 with a Remote Control vault page that installs this
//! controller as the target's factory Administrator, so one drag-and-drop both flashes the board
//! and makes it trust this machine; with `--flash` it also restarts the board into its bootloader
//! and copies the image itself. `flash` updates the firmware the same way and keeps the board's
//! identity, owner, name and LoRa settings. Every other command connects over USB Auto,
//! authenticates as that controller, and performs one typed operation; `set` changes single
//! settings live, without reflashing.
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::{Parser, Subcommand, ValueEnum};
use personal_hopspot_headless::control::public_identity;
use personal_hopspot_memory::{memory_profile_named, ProcessorArchitecture, RegionRole};
use personal_rns::identity::{PrivateIdentityMaterial, PublicIdentityMaterial};
use personal_rns::interfaces::subghz::RegulatoryRegion;
use personal_rns::interfaces::InterfaceId;
use personal_rns::prelude::*;
use personal_rns::remote_control::{
    encode_remote_control_vault_page, RemoteControlControllerAuthority,
    RemoteControlInterfaceConfigOutcome, RemoteControlInterfaceContinuation,
    RemoteControlInterfacePage, RemoteControlInterfacePeersOutcome, RemoteControlInterfacePower,
    RemoteControlLoRaProfile, RemoteControlPeerContinuation, RemoteControlPeerPage,
    RemoteControlRequestSet, RemoteControlSystemPower,
};
use personal_rns::runtime::{generate_identity_secret, RemoteControlIdentityDirectory};
use personal_rns::usb_auto::AutoUsb;
use serde_json::json;

/// Address of the `remote-control-identity` page in a UF2-flashed nRF52840 memory profile, which the
/// firmware reads at boot for the target identity and its factory owner grant.
fn remote_control_identity_address(board: &str) -> Result<u32, Error> {
    let unsupported = || Error::Board(board.to_string());
    let profile = memory_profile_named(board).ok_or_else(unsupported)?;
    if profile.architecture != ProcessorArchitecture::ThumbV7em {
        return Err(unsupported());
    }
    let region = profile
        .unique_region_for_role(RegionRole::RemoteControlIdentity)
        .map_err(|_| unsupported())?;
    u32::try_from(region.range.start()).map_err(|_| unsupported())
}

const UF2_MAGIC_START0: u32 = 0x0A32_4655;
const UF2_MAGIC_START1: u32 = 0x9E5D_5157;
const UF2_MAGIC_END: u32 = 0x0AB1_6F30;
const UF2_FLAG_FAMILY_ID: u32 = 0x0000_2000;
const UF2_BLOCK_BYTES: usize = 512;
const UF2_PAYLOAD_BYTES: usize = 256;
const NRF52840_UF2_FAMILY: u32 = 0xADA5_2840;
const OPERATION_TIMEOUT: Duration = Duration::from_secs(60);
/// How long to keep asking for a path over the board's own USB connection before accepting one
/// relayed through another attached board.
const DIRECT_PATH_WAIT: Duration = Duration::from_secs(30);
/// USB identity of a running Hopspot (prns-core `WEBUSB_VENDOR_ID` / `WEBUSB_PRODUCT_ID`).
const HOPSPOT_USB_VENDOR: u16 = 0x1209;
const HOPSPOT_USB_PRODUCT: u16 = 0x0001;
/// The vendor request a running Hopspot answers by restarting into its UF2 bootloader
/// (prns-core `BOOTLOADER_ENTRY_CONTROL_*`), so flashing needs no button presses.
const BOOTLOADER_ENTRY_REQUEST: u8 = 0x50;
const BOOTLOADER_ENTRY_VALUE: u16 = 0x5052;
const BOOTLOADER_ENTRY_INDEX: u16 = 0x4e53;
/// How long to wait for the bootloader drive, and then for the flashed board to come back.
const DRIVE_WAIT: Duration = Duration::from_secs(90);
const REBOOT_WAIT: Duration = Duration::from_secs(30);

#[derive(Parser)]
struct Options {
    /// Private controller state; keep it, or the board must be re-provisioned.
    #[arg(long, default_value_os_t = default_state_dir())]
    state_dir: PathBuf,
    /// Name of the provisioned board inside the state directory.
    #[arg(long, default_value = "rak4631")]
    device: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Build a UF2 that flashes the firmware and installs this controller as the board's owner.
    Provision {
        /// The board's memory profile (rak4631, rak10724, wio-tracker-l1, ...); it sets where the
        /// owner page is written.
        #[arg(long, default_value = "rak4631")]
        board: String,
        /// Firmware UF2 from `tools/build/hopspot-nrf52840.sh BOARD`.
        #[arg(long)]
        firmware: PathBuf,
        /// Combined UF2 to write. It contains the board's private Remote Control key.
        #[arg(long, required_unless_present = "flash")]
        out: Option<PathBuf>,
        /// Restart the board into its bootloader and copy the image onto it (deleting the
        /// combined UF2 afterwards). A board not yet running Hopspot needs a double-press of RESET.
        #[arg(long)]
        flash: bool,
    },
    /// Update the firmware and keep the board's identity, owner, name and LoRa settings: restarts
    /// the board into its bootloader and copies the UF2 onto it.
    Flash {
        /// Firmware UF2 from `tools/build/hopspot-nrf52840.sh BOARD`.
        uf2: PathBuf,
    },
    /// Change one or more settings live; anything left out keeps its current value.
    ///
    /// Example: `set --tx-power-dbm 22`, `set --region EU868`, `set --name Box-Hopspot`.
    /// A new region without `--frequency-mhz` starts from that region's default LoRa profile.
    Set(SetArgs),
    /// Build version, interfaces, and the LoRa configuration.
    Status,
    /// Set and persist the LoRa profile.
    Lora {
        /// Regulatory region label, e.g. US915, EU868; `Custom` skips regional limits.
        #[arg(long)]
        region: String,
        #[arg(long)]
        frequency_hz: u32,
        #[arg(long, value_parser = ["125", "250", "500"])]
        bandwidth_khz: String,
        #[arg(long, value_parser = clap::value_parser!(u8).range(5..=12))]
        spreading_factor: u8,
        /// Coding-rate denominator: 5 for 4/5 through 8 for 4/8.
        #[arg(long, value_parser = clap::value_parser!(u8).range(5..=8))]
        coding_rate: u8,
        #[arg(long)]
        tx_power_dbm: i8,
        #[arg(long, default_value_t = 18)]
        preamble: u16,
    },
    /// Turn one interface on or off: `lora`, `bluetooth`, `usb`, or an ID from `status`.
    Interface {
        #[arg(value_parser = interface_ref)]
        id: InterfaceRef,
        #[arg(value_enum)]
        power: Power,
    },
    /// List the peers one interface currently sees: `lora`, `bluetooth`, `usb`, or an ID from `status`.
    Peers {
        #[arg(value_parser = interface_ref)]
        id: InterfaceRef,
    },
    /// Put the whole node to sleep or wake it.
    System {
        #[arg(value_enum)]
        power: SystemPower,
    },
    /// Announce the node's page on every interface.
    Announce,
    /// Give another controller (for example the Hopspot Configure page) full control.
    Authorize {
        /// The controller's 64-byte public key as 128 hex digits.
        #[arg(long)]
        public_key: String,
    },
    /// Print the board's public key, which other controllers need to address it.
    BoardKey,
    /// Print this controller's public key, to authorize it on a board owned elsewhere.
    OwnerKey,
    /// Show the board's announced name, or rename it with `--set`.
    Name {
        /// New name: 1 to 64 bytes of UTF-8, without control characters or surrounding whitespace.
        #[arg(long)]
        set: Option<String>,
    },
}

#[derive(clap::Args)]
struct SetArgs {
    /// Announced name.
    #[arg(long)]
    name: Option<String>,
    /// Regulatory region label, e.g. US915, EU868; `Custom` skips regional limits.
    #[arg(long)]
    region: Option<String>,
    /// Center frequency in MHz, e.g. 918.3.
    #[arg(long)]
    frequency_mhz: Option<f64>,
    #[arg(long, value_parser = ["125", "250", "500"])]
    bandwidth_khz: Option<String>,
    #[arg(long, value_parser = clap::value_parser!(u8).range(5..=12))]
    spreading_factor: Option<u8>,
    /// Coding-rate denominator: 5 for 4/5 through 8 for 4/8.
    #[arg(long, value_parser = clap::value_parser!(u8).range(5..=8))]
    coding_rate: Option<u8>,
    #[arg(long)]
    tx_power_dbm: Option<i8>,
    #[arg(long)]
    preamble: Option<u16>,
}

impl SetArgs {
    fn changes_lora(&self) -> bool {
        self.region.is_some()
            || self.frequency_mhz.is_some()
            || self.bandwidth_khz.is_some()
            || self.spreading_factor.is_some()
            || self.coding_rate.is_some()
            || self.tx_power_dbm.is_some()
            || self.preamble.is_some()
    }
}

/// A LoRa profile's fields, in the units the `lora` command takes.
#[derive(Clone)]
struct LoraSettings {
    region: String,
    frequency_hz: u32,
    bandwidth_khz: String,
    spreading_factor: u8,
    coding_rate: u8,
    tx_power_dbm: i8,
    preamble: u16,
}

impl LoraSettings {
    fn of(profile: personal_rns::interfaces::lora::RadioProfile) -> Self {
        use personal_rns::interfaces::lora::Modulation;
        use personal_rns::interfaces::subghz::SubGRegion;
        let Modulation::Lora {
            spreading_factor,
            bandwidth,
            coding_rate,
        } = profile.modulation();
        Self {
            region: match profile.region() {
                SubGRegion::Regulated(region) => region.label().to_owned(),
                SubGRegion::Custom => "Custom".to_owned(),
            },
            frequency_hz: profile.frequency().hz(),
            bandwidth_khz: (bandwidth.hz() / 1_000).to_string(),
            spreading_factor: spreading_factor as u8,
            coding_rate: coding_rate.denominator(),
            tx_power_dbm: profile.tx_power().dbm(),
            preamble: profile.preamble().count(),
        }
    }

    /// The region's built-in LoRa profile, the starting point when only the region changes.
    fn region_default(label: &str) -> Result<Self, Error> {
        use personal_rns::interfaces::subghz::{ResolvedSubGMode, SubGConfiguration, SubGRegion};
        let region = if label.eq_ignore_ascii_case("custom") {
            return Err(Error::Invalid(
                "a Custom region needs --frequency-mhz and the other LoRa settings".into(),
            ));
        } else {
            let label = region_label(label)?;
            RegulatoryRegion::ALL
                .into_iter()
                .find(|region| region.label() == label)
                .map(SubGRegion::Regulated)
                .ok_or(Error::Profile)?
        };
        let configuration = SubGConfiguration::auto_lora_for(region).map_err(|_| {
            Error::Invalid(format!(
                "{label} has no built-in LoRa default; pass --frequency-mhz too (and any other setting that should change)"
            ))
        })?;
        let ResolvedSubGMode::LoRa(profile) = configuration.resolve();
        Ok(Self::of(profile))
    }

    fn with(mut self, change: &SetArgs) -> Result<Self, Error> {
        if let Some(region) = &change.region {
            if change.frequency_mhz.is_none() && !region.eq_ignore_ascii_case(&self.region) {
                self = Self::region_default(region)?;
            }
            self.region = region.clone();
        }
        if let Some(mhz) = change.frequency_mhz {
            if !(mhz.is_finite() && (100.0..=3_000.0).contains(&mhz)) {
                return Err(Error::Invalid(format!("{mhz} MHz is not a LoRa frequency")));
            }
            self.frequency_hz = (mhz * 1_000_000.0).round() as u32;
        }
        if let Some(bandwidth) = &change.bandwidth_khz {
            self.bandwidth_khz = bandwidth.clone();
        }
        self.spreading_factor = change.spreading_factor.unwrap_or(self.spreading_factor);
        self.coding_rate = change.coding_rate.unwrap_or(self.coding_rate);
        self.tx_power_dbm = change.tx_power_dbm.unwrap_or(self.tx_power_dbm);
        self.preamble = change.preamble.unwrap_or(self.preamble);
        Ok(self)
    }

    fn profile(&self) -> Result<RemoteControlLoRaProfile, Error> {
        lora_profile(
            &self.region,
            self.frequency_hz,
            &self.bandwidth_khz,
            self.spreading_factor,
            self.coding_rate,
            self.tx_power_dbm,
            self.preamble,
        )
    }

    fn json(&self) -> serde_json::Value {
        json!({
            "region": self.region, "frequency_mhz": f64::from(self.frequency_hz) / 1_000_000.0,
            "bandwidth_khz": self.bandwidth_khz, "spreading_factor": self.spreading_factor,
            "coding_rate": format!("4/{}", self.coding_rate), "tx_power_dbm": self.tx_power_dbm,
            "preamble": self.preamble,
        })
    }
}

#[derive(Clone, Copy, ValueEnum)]
enum Power {
    On,
    Off,
}

#[derive(Clone, Copy, ValueEnum)]
enum SystemPower {
    Awake,
    Asleep,
}

fn default_state_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config/prns-usb-config")
}

/// An interface named by kind or by its ID from `status`.
#[derive(Clone)]
enum InterfaceRef {
    Id(InterfaceId),
    Kind(&'static str),
}

fn interface_ref(value: &str) -> Result<InterfaceRef, String> {
    match value.to_ascii_lowercase().as_str() {
        "lora" => Ok(InterfaceRef::Kind("LoRa")),
        "bluetooth" | "ble" => Ok(InterfaceRef::Kind("Bluetooth")),
        "usb" => Ok(InterfaceRef::Kind("UsbAuto")),
        _ => interface_id(value)
            .map(InterfaceRef::Id)
            .map_err(|error| format!("{error}; or use lora, bluetooth or usb")),
    }
}

fn interface_id(value: &str) -> Result<InterfaceId, String> {
    let bytes = hex::decode(value).map_err(|error| error.to_string())?;
    let bytes: [u8; 8] = bytes
        .try_into()
        .map_err(|_| "interface ID must be 8 bytes (16 hex digits)".to_owned())?;
    Ok(InterfaceId::new(bytes))
}

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error(transparent)]
    Identity(#[from] personal_rns::runtime::RemoteControlFileIdentityBootstrapError),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("controller state is in use by another run: {0}")]
    Lock(std::fs::TryLockError),
    #[error("firmware UF2: {0}")]
    Uf2(String),
    #[error("`{0}` is not a UF2-flashed nRF52840 memory profile")]
    Board(String),
    #[error("board `{0}` is not provisioned; run `provision` first")]
    NotProvisioned(String),
    #[error("device record: {0}")]
    Record(String),
    #[error("unknown region `{0}`; expected one of: {1}")]
    Region(String, String),
    #[error("the LoRa profile is outside what the firmware accepts")]
    Profile,
    #[error("target grant: {0:?}")]
    Grant(RemoteControlTargetAccessError),
    #[error("target provisioning: {0:?}")]
    Provision(personal_rns::runtime::SetRemoteControlTargetAccessControlError),
    #[error("target connection: {0:?}")]
    Connect(personal_rns::runtime::ConnectRemoteControlTargetError),
    #[error("remote operation: {0:?}")]
    Operation(personal_rns::runtime::RemoteControlTargetOperationError),
    #[error("board did not answer within {OPERATION_TIMEOUT:?} at stage: {0}")]
    Timeout(&'static str),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("USB: {0}")]
    Usb(String),
    #[error("remote inventory exceeded 256 pages")]
    Pagination,
    #[error("controller node stopped: {0:?}")]
    Node(Result<(), personal_rns::runtime::NodeRunError>),
}

fn device_record(state_dir: &Path, device: &str) -> PathBuf {
    state_dir.join("devices").join(format!("{device}.json"))
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options.open(path)?.write_all(bytes)?;
    Ok(())
}

fn uf2_block(address: u32, payload: &[u8], index: u32, total: u32) -> [u8; UF2_BLOCK_BYTES] {
    let mut block = [0u8; UF2_BLOCK_BYTES];
    let words = [
        UF2_MAGIC_START0,
        UF2_MAGIC_START1,
        UF2_FLAG_FAMILY_ID,
        address,
        UF2_PAYLOAD_BYTES as u32,
        index,
        total,
        NRF52840_UF2_FAMILY,
    ];
    for (slot, word) in block.as_chunks_mut::<4>().0.iter_mut().zip(words) {
        *slot = word.to_le_bytes();
    }
    block[32..32 + payload.len()].copy_from_slice(payload);
    block[UF2_BLOCK_BYTES - 4..].copy_from_slice(&UF2_MAGIC_END.to_le_bytes());
    block
}

fn le_word(block: &[u8], word: usize) -> u32 {
    u32::from_le_bytes(block[word * 4..word * 4 + 4].try_into().unwrap_or_default())
}

/// Append the vault page to the firmware UF2, renumbering every block so the bootloader counts
/// the combined image as one transfer.
fn merge_uf2(firmware: &[u8], page_address: u32, page: &[u8]) -> Result<Vec<u8>, Error> {
    if firmware.is_empty() || !firmware.len().is_multiple_of(UF2_BLOCK_BYTES) {
        return Err(Error::Uf2("not a whole number of 512-byte blocks".into()));
    }
    let page_end = u64::from(page_address) + page.len() as u64;
    let mut payloads = Vec::new();
    for block in firmware.as_chunks::<UF2_BLOCK_BYTES>().0 {
        if le_word(block, 0) != UF2_MAGIC_START0
            || le_word(block, 1) != UF2_MAGIC_START1
            || le_word(block, 127) != UF2_MAGIC_END
        {
            return Err(Error::Uf2("bad block magic".into()));
        }
        if le_word(block, 7) != NRF52840_UF2_FAMILY {
            return Err(Error::Uf2("not an nRF52840 UF2".into()));
        }
        let address = le_word(block, 3);
        let size = le_word(block, 4) as usize;
        if size > 476 {
            return Err(Error::Uf2("oversized block payload".into()));
        }
        if u64::from(address) < page_end
            && u64::from(address) + size as u64 > u64::from(page_address)
        {
            return Err(Error::Uf2(format!(
                "firmware overlaps the Remote Control identity page at {page_address:#x}; rebuild it from this branch"
            )));
        }
        payloads.push((address, block[32..32 + size].to_vec()));
    }
    for (offset, chunk) in page.chunks(UF2_PAYLOAD_BYTES).enumerate() {
        payloads.push((
            page_address + (offset * UF2_PAYLOAD_BYTES) as u32,
            chunk.to_vec(),
        ));
    }
    let total = payloads.len() as u32;
    let mut merged = Vec::with_capacity(payloads.len() * UF2_BLOCK_BYTES);
    for (index, (address, payload)) in payloads.iter().enumerate() {
        merged.extend_from_slice(&uf2_block(*address, payload, index as u32, total));
    }
    Ok(merged)
}

fn lock_state(state_dir: &Path) -> Result<std::fs::File, Error> {
    std::fs::create_dir_all(state_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(state_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(state_dir.join("controller.lock"))?;
    lock.try_lock().map_err(Error::Lock)?;
    Ok(lock)
}

fn provision(
    options: &Options,
    board: &str,
    firmware: &Path,
    out: Option<&Path>,
    flash: bool,
) -> Result<(), Error> {
    let address = remote_control_identity_address(board)?;
    let (secrets, _) = RemoteControlIdentityDirectory::new(options.state_dir.join("identity"))
        .load_or_generate()?
        .into_parts();
    let identities = secrets.identities();
    let controller = identities.controller().public_keys();
    let target_secret = generate_identity_secret();
    let target_public = PrivateIdentityMaterial::from_bytes(*target_secret).public();
    let page = encode_remote_control_vault_page(&target_secret, controller)
        .map_err(|error| Error::Uf2(format!("vault page: {error:?}")))?;
    let merged = merge_uf2(&std::fs::read(firmware)?, address, &page)?;
    let out = match out {
        Some(out) => out.to_path_buf(),
        None => options.state_dir.join("provision.uf2"),
    };
    write_private(&out, &merged)?;
    let record = json!({
        "board": board,
        "target_public_key": hex::encode(target_public.as_bytes()),
    });
    write_private(
        &device_record(&options.state_dir, &options.device),
        record.to_string().as_bytes(),
    )?;
    println!(
        "{}",
        json!({
            "event": "provisioned",
            "device": options.device,
            "uf2": out,
            "target_hash": hex::encode(target_public.identity_hash().as_bytes()),
            "controller_hash": hex::encode(identities.controller().identity_hash().as_bytes()),
            "note": if flash {
                "flashing it now"
            } else {
                "copy the UF2 to the board's bootloader drive, then delete it: it holds the board's private key"
            },
        })
    );
    if flash {
        let flashed = flash_uf2(&out);
        // The combined image holds the board's private key; it is never needed again.
        let _ = std::fs::remove_file(&out);
        flashed?;
    }
    Ok(())
}

/// Ask every running Hopspot on USB to restart into its UF2 bootloader; returns how many were asked.
fn restart_into_bootloader() -> Result<usize, Error> {
    use nusb::transfer::{ControlOut, ControlType, Recipient};
    use nusb::MaybeFuture;
    let boards: Vec<_> = nusb::list_devices()
        .wait()
        .map_err(|error| Error::Usb(error.to_string()))?
        .filter(|device| {
            device.vendor_id() == HOPSPOT_USB_VENDOR && device.product_id() == HOPSPOT_USB_PRODUCT
        })
        .collect();
    if boards.len() > 1 {
        return Err(Error::Usb(format!(
            "{} Hopspots are plugged in; unplug all but the one to flash",
            boards.len()
        )));
    }
    for board in &boards {
        let device = board
            .open()
            .wait()
            .map_err(|error| Error::Usb(format!("open the board: {error}")))?;
        // The board resets while answering, so a transfer error here is expected.
        let _ = device
            .control_out(
                ControlOut {
                    control_type: ControlType::Vendor,
                    recipient: Recipient::Device,
                    request: BOOTLOADER_ENTRY_REQUEST,
                    value: BOOTLOADER_ENTRY_VALUE,
                    index: BOOTLOADER_ENTRY_INDEX,
                    data: &[],
                },
                Duration::from_secs(1),
            )
            .wait();
    }
    Ok(boards.len())
}

fn hopspot_on_usb() -> bool {
    use nusb::MaybeFuture;
    nusb::list_devices().wait().is_ok_and(|mut devices| {
        devices.any(|device| {
            device.vendor_id() == HOPSPOT_USB_VENDOR && device.product_id() == HOPSPOT_USB_PRODUCT
        })
    })
}

/// Mounted UF2 bootloader drives: directories holding `INFO_UF2.TXT`.
fn uf2_drives() -> Vec<PathBuf> {
    let user = std::env::var("USER").unwrap_or_default();
    let roots = [
        PathBuf::from("/run/media").join(&user),
        PathBuf::from("/media").join(&user),
        PathBuf::from("/media"),
        PathBuf::from("/Volumes"),
    ];
    let mut drives: Vec<PathBuf> = roots
        .iter()
        .filter_map(|root| std::fs::read_dir(root).ok())
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.join("INFO_UF2.TXT").is_file())
        .collect();
    drives.sort();
    drives.dedup();
    drives
}

/// Linux desktops often leave a new USB drive unmounted; mount unmounted USB block devices with
/// udisks so the bootloader drive appears. Best effort: does nothing where udisks is missing.
fn mount_usb_drives() {
    #[cfg(target_os = "linux")]
    {
        let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
        let Ok(labels) = std::fs::read_dir("/dev/disk/by-label") else {
            return;
        };
        for entry in labels.filter_map(Result::ok) {
            let Ok(device) = std::fs::canonicalize(entry.path()) else {
                continue;
            };
            let Some(name) = device.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let on_usb = std::fs::canonicalize(format!("/sys/class/block/{name}"))
                .is_ok_and(|path| path.to_string_lossy().contains("/usb"));
            let mounted = mounts
                .lines()
                .any(|line| line.split(' ').next() == device.to_str());
            if on_usb && !mounted {
                let _ = std::process::Command::new("udisksctl")
                    .args(["mount", "--no-user-interaction", "-b"])
                    .arg(&device)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
        }
    }
}

fn wait_for_uf2_drive() -> Result<PathBuf, Error> {
    let deadline = std::time::Instant::now() + DRIVE_WAIT;
    loop {
        mount_usb_drives();
        match uf2_drives().as_slice() {
            [drive] => return Ok(drive.clone()),
            [] if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(500))
            }
            [] => {
                return Err(Error::Usb(
                    "no bootloader drive appeared; double-press the board's RESET button and run this again, or copy the UF2 onto the drive yourself".into(),
                ))
            }
            drives => {
                return Err(Error::Usb(format!(
                    "several bootloader drives are mounted ({drives:?}); leave only the board to flash"
                )))
            }
        }
    }
}

/// Restart the board into its bootloader, copy `uf2` onto its drive and wait for it to boot.
fn flash_uf2(uf2: &Path) -> Result<(), Error> {
    let image = std::fs::read(uf2)?;
    if image.is_empty() || !image.len().is_multiple_of(UF2_BLOCK_BYTES) {
        return Err(Error::Uf2("not a whole number of 512-byte blocks".into()));
    }
    let drive = if let [drive] = uf2_drives().as_slice() {
        drive.clone()
    } else {
        if restart_into_bootloader()? == 0 {
            eprintln!(
                "No running Hopspot found on USB. Double-press the board's RESET button to open its bootloader drive."
            );
        }
        wait_for_uf2_drive()?
    };
    let model = std::fs::read_to_string(drive.join("INFO_UF2.TXT"))
        .ok()
        .and_then(|info| {
            info.lines()
                .find_map(|line| line.strip_prefix("Model: ").map(str::to_owned))
        });
    println!(
        "{}",
        json!({"event":"flashing","drive":drive,"model":model,"bytes":image.len()})
    );
    {
        use std::io::Write;
        let mut file = std::fs::File::create(drive.join("hopspot.uf2"))?;
        file.write_all(&image)?;
        // The bootloader resets as soon as the last block lands, which can fail the final sync.
        let _ = file.sync_all();
    }
    let deadline = std::time::Instant::now() + REBOOT_WAIT;
    while !hopspot_on_usb() {
        if std::time::Instant::now() >= deadline {
            return Err(Error::Usb(
                "the image was copied but the board did not come back as a Hopspot; check that the UF2 matches this board".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    println!("{}", json!({"event":"flashed"}));
    Ok(())
}

fn load_target(options: &Options) -> Result<PublicIdentityMaterial, Error> {
    let path = device_record(&options.state_dir, &options.device);
    let text = std::fs::read_to_string(&path)
        .map_err(|_| Error::NotProvisioned(options.device.clone()))?;
    let record: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| Error::Record(error.to_string()))?;
    let key = record["target_public_key"]
        .as_str()
        .ok_or_else(|| Error::Record("missing target_public_key".into()))?;
    public_identity(key).map_err(|error| Error::Record(error.to_string()))
}

/// The canonical label of a regulatory region (case-insensitive), or `Custom`.
fn region_label(region: &str) -> Result<&'static str, Error> {
    if region.eq_ignore_ascii_case("custom") {
        return Ok("Custom");
    }
    RegulatoryRegion::ALL
        .into_iter()
        .map(RegulatoryRegion::label)
        .find(|label| label.eq_ignore_ascii_case(region))
        .ok_or_else(|| {
            let known = RegulatoryRegion::ALL
                .into_iter()
                .map(RegulatoryRegion::label)
                .chain(["Custom"])
                .collect::<Vec<_>>()
                .join(", ");
            Error::Region(region.to_owned(), known)
        })
}

fn lora_profile(
    region: &str,
    frequency_hz: u32,
    bandwidth_khz: &str,
    spreading_factor: u8,
    coding_rate: u8,
    tx_power_dbm: i8,
    preamble: u16,
) -> Result<RemoteControlLoRaProfile, Error> {
    let label = region_label(region)?;
    RemoteControlLoRaProfile::parse(&format!(
        "LoRa,{label},{frequency_hz},{spreading_factor},{bandwidth_khz},{coding_rate},{tx_power_dbm},{preamble}"
    ))
    .ok_or(Error::Profile)
}

async fn control(options: Options) -> Result<(), Error> {
    let _lock = lock_state(&options.state_dir)?;
    if let Command::Provision {
        board,
        firmware,
        out,
        flash,
    } = &options.command
    {
        return provision(&options, board, firmware, out.as_deref(), *flash);
    }
    if let Command::Flash { uf2 } = &options.command {
        return flash_uf2(uf2);
    }
    if let Command::OwnerKey = &options.command {
        let (secrets, _) = RemoteControlIdentityDirectory::new(options.state_dir.join("identity"))
            .load_or_generate()?
            .into_parts();
        let identities = secrets.identities();
        println!(
            "{}",
            json!({
                "event":"owner_key",
                "public_key":hex::encode(identities.controller().public_keys().public_key_bytes()),
            })
        );
        return Ok(());
    }
    if let Command::BoardKey = &options.command {
        let key = load_target(&options)?;
        println!(
            "{}",
            json!({"event":"board_key","device":options.device,"public_key":hex::encode(key.as_bytes())})
        );
        return Ok(());
    }
    let new_name = match &options.command {
        Command::Name { set: Some(name) }
        | Command::Set(SetArgs {
            name: Some(name), ..
        }) => Some(
            personal_rns::remote_control::RemoteControlNodeName::new(name).ok_or_else(|| {
                Error::Record("a name is 1 to 32 bytes, without leading or trailing spaces".into())
            })?,
        ),
        _ => None,
    };
    let authorize = match &options.command {
        Command::Authorize { public_key } => Some(
            hex::decode(public_key.trim())
                .ok()
                .and_then(|bytes| {
                    personal_rns::remote_control::parse_controller_public_keys(&bytes)
                })
                .ok_or_else(|| Error::Record("--public-key must be 128 hex digits".into()))?,
        ),
        _ => None,
    };
    // Validate local arguments before touching USB.
    let lora = match &options.command {
        Command::Lora {
            region,
            frequency_hz,
            bandwidth_khz,
            spreading_factor,
            coding_rate,
            tx_power_dbm,
            preamble,
        } => Some(lora_profile(
            region,
            *frequency_hz,
            bandwidth_khz,
            *spreading_factor,
            *coding_rate,
            *tx_power_dbm,
            *preamble,
        )?),
        _ => None,
    };
    if let Command::Set(change) = &options.command {
        if let Some(region) = &change.region {
            region_label(region)?;
        }
        if change.name.is_none() && !change.changes_lora() {
            return Err(Error::Invalid(
                "nothing to change; pass a setting such as --tx-power-dbm 22 (see `set --help`)"
                    .into(),
            ));
        }
    }
    let target_key = load_target(&options)?;
    let (secrets, _) = RemoteControlIdentityDirectory::new(options.state_dir.join("identity"))
        .load_or_generate()?
        .into_parts();
    let target = RemoteControlTargetIdentity::new(target_key.public_keys());
    let endpoint = target.endpoint().destination_hash();
    let target_hash = target.identity_hash();
    let grant = RemoteControlTargetAccess::new(
        target,
        RemoteControlControllerAuthority::Administrator,
        RemoteControlRequestSet::all(),
    )
    .map_err(Error::Grant)?;
    let node = PrnsNode::new(PrnsNodeRecipe {
        transport_identity: None,
        remote_control: RemoteControlService::new(
            secrets,
            RemoteControlInitialControllerGrants::Nobody,
            RemoteControlSelfAnnouncement::Unavailable,
        )
        .into(),
        pre_configured_destinations: [] as [PreConfiguredDestination<'static>; 0],
        app_state: personal_rns::runtime::NoRemoteControlHostControls,
        storage: GrowableHeap,
        request_endpoints: request_endpoints![],
        interfaces: ManuallyAttached,
        persistence: NoPersistence,
        on_event: |_event, _state| {},
    });
    let handle = node.handle();
    handle.attach(AutoUsb::default());
    let stage = std::cell::Cell::new("target provisioning");
    let operation = async {
        handle
            .set_remote_control_target_access(grant)
            .await
            .map_err(Error::Provision)?;
        // USB Auto enumerates and handshakes asynchronously; keep asking for the path until the
        // board answers through it.
        stage.set("finding the board over USB");
        // Every Hopspot on USB is attached, so another board bridged to this one (over Bluetooth,
        // say) can answer with a longer path; links over that detour are slow and can time out.
        // Prefer the board's own USB connection, falling back to a relayed path only if no direct
        // path turns up.
        let direct_deadline = tokio::time::Instant::now() + DIRECT_PATH_WAIT;
        loop {
            match handle.request_path(endpoint).await {
                Ok(found) if found.hops.0 <= 1 => break,
                Ok(_) if tokio::time::Instant::now() >= direct_deadline => break,
                Ok(_) | Err(_) => tokio::time::sleep(Duration::from_millis(500)).await,
            }
        }
        stage.set("authenticated connection");
        let connection = handle
            .connect_remote_control_target(target_hash)
            .await
            .map_err(Error::Connect)?;
        stage.set("remote operation");
        match &options.command {
            Command::Provision { .. } => {}
            Command::Status => {
                let (build, _) = connection
                    .describe_build()
                    .await
                    .map_err(Error::Operation)?;
                println!("{}", json!({"event":"build","version":build.as_str()}));
                let mut page = RemoteControlInterfacePage::First;
                let mut completion = Err(Error::Pagination);
                for _ in 0..256 {
                    let (inventory, _) = connection
                        .inventory_interfaces_page(page)
                        .await
                        .map_err(Error::Operation)?;
                    for entry in inventory.entries() {
                        let config = match connection
                            .inventory_interface_config(entry.id)
                            .await
                            .map_err(Error::Operation)?
                            .0
                        {
                            RemoteControlInterfaceConfigOutcome::Card(card) => {
                                Some(card.config.as_str().to_owned())
                            }
                            RemoteControlInterfaceConfigOutcome::UnknownInterface => None,
                        };
                        println!(
                            "{}",
                            json!({
                                "event":"interface","id":hex::encode(entry.id.as_bytes()),
                                "kind":format!("{:?}",entry.kind),"enabled":entry.enabled,
                                "connection":format!("{:?}",entry.connection),
                                "tx_bytes":entry.tx_bytes,"rx_bytes":entry.rx_bytes,
                                "config":config,
                            })
                        );
                    }
                    match inventory.continuation() {
                        RemoteControlInterfaceContinuation::Complete => {
                            completion = Ok(());
                            break;
                        }
                        RemoteControlInterfaceContinuation::More(cursor) => {
                            page = RemoteControlInterfacePage::After(cursor)
                        }
                    }
                }
                completion?;
            }
            Command::Lora { .. } => {
                let profile = lora.ok_or(Error::Profile)?;
                let lora_id = lora_interface(&connection).await?;
                let (outcome, _) = connection
                    .set_interface_lora_profile(lora_id, profile)
                    .await
                    .map_err(Error::Operation)?;
                println!(
                    "{}",
                    json!({"event":"lora","interface":hex::encode(lora_id.as_bytes()),"outcome":format!("{outcome:?}")})
                );
            }
            Command::Interface { id, power } => {
                let power = match power {
                    Power::On => RemoteControlInterfacePower::On,
                    Power::Off => RemoteControlInterfacePower::Off,
                };
                let id = resolve_interface(&connection, id).await?;
                let (outcome, _) = connection
                    .set_interface_power(id, power)
                    .await
                    .map_err(Error::Operation)?;
                println!(
                    "{}",
                    json!({"event":"interface_power","interface":hex::encode(id.as_bytes()),"outcome":format!("{outcome:?}")})
                );
            }
            Command::Peers { id } => {
                let id = resolve_interface(&connection, id).await?;
                let mut page = RemoteControlPeerPage::First;
                let mut completion = Err(Error::Pagination);
                for _ in 0..256 {
                    let (outcome, _) = connection
                        .inventory_interface_peers(id, page)
                        .await
                        .map_err(Error::Operation)?;
                    let RemoteControlInterfacePeersOutcome::Page(peers) = outcome else {
                        println!("{}", json!({"event":"peers","status":"unknown_interface"}));
                        completion = Ok(());
                        break;
                    };
                    for peer in peers.peers.iter() {
                        println!(
                            "{}",
                            json!({
                                "event":"peer","id":hex::encode(peer.id.as_bytes()),
                                "connection":format!("{:?}",peer.connection),
                                "tx_bytes":peer.tx_bytes,"rx_bytes":peer.rx_bytes,
                                "links":peer.links,"destinations":peer.destinations,
                                "radio":format!("{:?}",peer.radio),
                                "details":format!("{:?}",peer.details),
                            })
                        );
                    }
                    match peers.continuation() {
                        RemoteControlPeerContinuation::Complete => {
                            completion = Ok(());
                            break;
                        }
                        RemoteControlPeerContinuation::More(cursor) => {
                            page = RemoteControlPeerPage::After(cursor)
                        }
                    }
                }
                completion?;
            }
            Command::System { power } => {
                let power = match power {
                    SystemPower::Awake => RemoteControlSystemPower::Awake,
                    SystemPower::Asleep => RemoteControlSystemPower::Asleep,
                };
                let (outcome, _) = connection
                    .set_system_power(power)
                    .await
                    .map_err(Error::Operation)?;
                println!(
                    "{}",
                    json!({"event":"system_power","outcome":format!("{outcome:?}")})
                );
            }
            Command::Announce => {
                connection.announce_self().await.map_err(Error::Operation)?;
                println!("{}", json!({"event":"announced"}));
            }
            Command::Authorize { .. } => {
                let controller = authorize.ok_or(Error::Profile)?;
                let (outcome, _) = connection
                    .authorize_controller(controller, RemoteControlRequestSet::all_operator())
                    .await
                    .map_err(Error::Operation)?;
                println!(
                    "{}",
                    json!({"event":"authorize","outcome":format!("{outcome:?}")})
                );
            }
            Command::BoardKey | Command::OwnerKey => {}
            Command::Flash { .. } => {}
            Command::Set(change) => {
                if let Some(name) = new_name {
                    let (outcome, _) = connection
                        .set_node_name(name)
                        .await
                        .map_err(Error::Operation)?;
                    println!(
                        "{}",
                        json!({"event":"set_name","name":name.as_str(),"outcome":format!("{outcome:?}")})
                    );
                }
                if change.changes_lora() {
                    let lora_id = lora_interface(&connection).await?;
                    let current = match connection
                        .inventory_interface_config(lora_id)
                        .await
                        .map_err(Error::Operation)?
                        .0
                    {
                        RemoteControlInterfaceConfigOutcome::Card(card) => {
                            personal_rns::interfaces::lora::RadioProfile::parse_inventory_config(
                                card.config.as_str(),
                            )
                        }
                        RemoteControlInterfaceConfigOutcome::UnknownInterface => None,
                    }
                    .ok_or_else(|| {
                        Error::Invalid("could not read the board's current LoRa settings".into())
                    })?;
                    let settings = LoraSettings::of(current).with(change)?;
                    let (outcome, _) = connection
                        .set_interface_lora_profile(lora_id, settings.profile()?)
                        .await
                        .map_err(Error::Operation)?;
                    println!(
                        "{}",
                        json!({"event":"lora","settings":settings.json(),"outcome":format!("{outcome:?}")})
                    );
                }
            }
            Command::Name { .. } => {
                if let Some(name) = new_name {
                    let (outcome, _) = connection
                        .set_node_name(name)
                        .await
                        .map_err(Error::Operation)?;
                    println!(
                        "{}",
                        json!({"event":"set_name","name":name.as_str(),"outcome":format!("{outcome:?}")})
                    );
                } else {
                    let (name, _) = connection
                        .describe_node_name()
                        .await
                        .map_err(Error::Operation)?;
                    println!("{}", json!({"event":"name","name":name.as_str()}));
                }
            }
        }
        connection.close();
        Ok(())
    };
    tokio::select! {
        result = tokio::time::timeout(OPERATION_TIMEOUT, operation) => result.map_err(|_| timeout_error(stage.get(), &options.device))?,
        result = node.run() => Err(Error::Node(result)),
    }
}

/// Explain the common reasons a board never answers instead of only naming the stage.
fn timeout_error(stage: &'static str, device: &str) -> Error {
    if stage != "finding the board over USB" {
        return Error::Timeout(stage);
    }
    if !hopspot_on_usb() {
        return Error::NotFound(
            "no Hopspot is plugged in (or it is still starting); check the USB cable and try again"
                .into(),
        );
    }
    Error::NotFound(format!(
        "a Hopspot is plugged in but it is not the board saved as `{device}`. Either another board \
         is connected (pick it with --device), or this board was set up again elsewhere (for \
         example from the web page), which gives it a new identity. Add it with the key from \
         wherever it was set up, or set it up again with `provision --flash`"
    ))
}

/// The LoRa interface's ID changes with its profile, so look it up rather than asking for it.
async fn lora_interface(
    connection: &personal_rns::runtime::RemoteControlTargetHandle<'_>,
) -> Result<InterfaceId, Error> {
    find_interface(connection, "LoRa").await
}

async fn resolve_interface(
    connection: &personal_rns::runtime::RemoteControlTargetHandle<'_>,
    interface: &InterfaceRef,
) -> Result<InterfaceId, Error> {
    match interface {
        InterfaceRef::Id(id) => Ok(*id),
        InterfaceRef::Kind(kind) => find_interface(connection, kind).await,
    }
}

/// The first interface whose kind contains `kind` (`LoRa`, `Bluetooth`, `UsbAuto`).
async fn find_interface(
    connection: &personal_rns::runtime::RemoteControlTargetHandle<'_>,
    kind: &str,
) -> Result<InterfaceId, Error> {
    let mut page = RemoteControlInterfacePage::First;
    for _ in 0..256 {
        let (inventory, _) = connection
            .inventory_interfaces_page(page)
            .await
            .map_err(Error::Operation)?;
        if let Some(entry) = inventory
            .entries()
            .iter()
            .find(|entry| format!("{:?}", entry.kind).contains(kind))
        {
            return Ok(entry.id);
        }
        match inventory.continuation() {
            RemoteControlInterfaceContinuation::Complete => break,
            RemoteControlInterfaceContinuation::More(cursor) => {
                page = RemoteControlInterfacePage::After(cursor)
            }
        }
    }
    Err(Error::Invalid(format!(
        "the board reports no {kind} interface"
    )))
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    match control(Options::parse()).await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("usb_config_failed: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn firmware(blocks: &[(u32, u8)]) -> Vec<u8> {
        let total = blocks.len() as u32;
        blocks
            .iter()
            .enumerate()
            .flat_map(|(index, (address, fill))| {
                uf2_block(*address, &[*fill; UF2_PAYLOAD_BYTES], index as u32, total)
            })
            .collect()
    }

    #[test]
    fn merge_appends_the_page_and_renumbers_every_block() {
        let page = [0xA5u8; 4096];
        let merged = merge_uf2(&firmware(&[(0x26000, 1), (0x26100, 2)]), 0xE2000, &page).unwrap();
        let blocks: Vec<_> = merged.chunks_exact(UF2_BLOCK_BYTES).collect();
        assert_eq!(blocks.len(), 2 + 16);
        for (index, block) in blocks.iter().enumerate() {
            assert_eq!(le_word(block, 5), index as u32);
            assert_eq!(le_word(block, 6), 18);
            assert_eq!(le_word(block, 7), NRF52840_UF2_FAMILY);
        }
        assert_eq!(le_word(blocks[2], 3), 0xE2000);
        assert_eq!(le_word(blocks[17], 3), 0xE2F00);
        assert_eq!(blocks[17][32], 0xA5);
        assert_eq!(blocks[1][32], 2);
    }

    #[test]
    fn merge_refuses_firmware_that_reaches_the_identity_page() {
        let error = merge_uf2(&firmware(&[(0xE2000, 1)]), 0xE2000, &[0; 4096]).unwrap_err();
        assert!(matches!(error, Error::Uf2(_)));
    }

    #[test]
    fn lora_profile_accepts_rnode_style_arguments() {
        assert!(lora_profile("us915", 918_300_000, "250", 10, 5, 22, 18).is_ok());
        assert!(matches!(
            lora_profile("mars", 918_300_000, "250", 10, 5, 22, 18),
            Err(Error::Region(..))
        ));
    }
}
