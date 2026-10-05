//! Remote Control controller helpers for browser pages.
//!
//! The browser runtime already establishes links, identifies, and sends requests. These helpers
//! own everything protocol-shaped around that: the owner identity and its provisioning page, the
//! target endpoint and request path, request encoding, and response decoding into plain objects.
//! Keeping the wire format in Rust means a page never re-implements it in JavaScript.

use js_sys::{Array, Object, Reflect};
use personal_rns::identity::{
    IdentityHash, PrivateIdentityMaterial, PublicIdentityMaterial, IDENTITY_PUBLIC_KEY_LEN,
    IDENTITY_SECRET_KEY_LEN,
};
use personal_rns::interfaces::{DiscoveryGroupId, DiscoveryGroupSet};
use personal_rns::interfaces::{InterfaceId, InterfaceMode};
use personal_rns::remote_control::{
    encode_remote_control_vault_page, parse_controller_public_keys,
    RemoteControlControllerContinuation, RemoteControlControllerCursor,
    RemoteControlControllerPage, RemoteControlDiscoveryGroups,
    RemoteControlDiscoveryGroupsInventoryOutcome, RemoteControlDisplayAutoOff,
    RemoteControlDisplayVisibility, RemoteControlGnssPower, RemoteControlInterfaceConfigOutcome,
    RemoteControlInterfaceContinuation, RemoteControlInterfaceCursor, RemoteControlInterfaceGroup,
    RemoteControlInterfacePage, RemoteControlInterfacePeersOutcome, RemoteControlInterfacePower,
    RemoteControlLoRaProfile, RemoteControlPeerContinuation, RemoteControlPeerCursor,
    RemoteControlPeerPage, RemoteControlRequest, RemoteControlRequestSet, RemoteControlResponse,
    RemoteControlSystemPower, RemoteControlTargetIdentity, REMOTE_CONTROL_REQUEST_ENDPOINT_ID,
};
use personal_rns::routing::request_handlers::RequestPathHash;
use wasm_bindgen::prelude::*;

const MAX_REQUEST_BYTES: usize = 512;

fn error(message: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn set(object: &Object, key: &str, value: impl Into<JsValue>) {
    let _ = Reflect::set(object, &JsValue::from_str(key), &value.into());
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn fixed<const N: usize>(bytes: &[u8], what: &str) -> Result<[u8; N], JsValue> {
    bytes
        .try_into()
        .map_err(|_| error(format!("{what} must be {N} bytes, got {}", bytes.len())))
}

fn interface(bytes: &[u8]) -> Result<InterfaceId, JsValue> {
    Ok(InterfaceId::new(fixed(bytes, "interface id")?))
}

fn encode(request: RemoteControlRequest) -> Result<Vec<u8>, JsValue> {
    let mut out = vec![0u8; MAX_REQUEST_BYTES];
    let written = request
        .write_into(&mut out)
        .map_err(|failure| error(format!("request encoding failed: {failure:?}")))?;
    out.truncate(written);
    Ok(out)
}

fn public_material(public_key: &[u8]) -> Result<PublicIdentityMaterial, JsValue> {
    PublicIdentityMaterial::from_slice(public_key).map_err(|_| {
        error(format!(
            "public key must be {IDENTITY_PUBLIC_KEY_LEN} bytes"
        ))
    })
}

// ---- identities and provisioning -------------------------------------------------------------

/// The 64-byte public key of a 64-byte identity secret (the browser node's own identity).
#[wasm_bindgen(js_name = rcIdentityPublicKey)]
pub fn rc_identity_public_key(secret: &[u8]) -> Result<Vec<u8>, JsValue> {
    let secret: [u8; IDENTITY_SECRET_KEY_LEN] = fixed(secret, "identity secret")?;
    Ok(PrivateIdentityMaterial::from_bytes(secret)
        .public()
        .as_bytes()
        .to_vec())
}

/// The 16-byte identity hash of a 64-byte public key.
#[wasm_bindgen(js_name = rcIdentityHash)]
pub fn rc_identity_hash(public_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    Ok(public_material(public_key)?
        .identity_hash()
        .as_bytes()
        .to_vec())
}

/// The target's Remote Control endpoint destination for its public key.
#[wasm_bindgen(js_name = rcTargetEndpoint)]
pub fn rc_target_endpoint(target_public_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let target =
        RemoteControlTargetIdentity::new(public_material(target_public_key)?.public_keys());
    Ok(target.endpoint().destination_hash().as_bytes().to_vec())
}

/// The request path hash every Remote Control request is sent to.
#[wasm_bindgen(js_name = rcRequestPathHash)]
pub fn rc_request_path_hash() -> Vec<u8> {
    RequestPathHash::of(REMOTE_CONTROL_REQUEST_ENDPOINT_ID)
        .as_bytes()
        .to_vec()
}

/// One flash page holding the target identity and the controller as its factory owner.
#[wasm_bindgen(js_name = rcVaultPage)]
pub fn rc_vault_page(
    target_secret: &[u8],
    controller_public_key: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let target_secret: [u8; IDENTITY_SECRET_KEY_LEN] = fixed(target_secret, "target secret")?;
    let controller = public_material(controller_public_key)?.public_keys();
    encode_remote_control_vault_page(&target_secret, &controller)
        .map(|page| page.to_vec())
        .map_err(|failure| error(format!("vault page: {failure:?}")))
}

// ---- requests --------------------------------------------------------------------------------

#[wasm_bindgen(js_name = rcRequestDescribe)]
pub fn rc_request_describe() -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::Describe)
}

#[wasm_bindgen(js_name = rcRequestDescribeBuild)]
pub fn rc_request_describe_build() -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::DescribeBuild)
}

#[wasm_bindgen(js_name = rcRequestDescribePower)]
pub fn rc_request_describe_power() -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::DescribePower)
}

#[wasm_bindgen(js_name = rcRequestAnnounceSelf)]
pub fn rc_request_announce_self() -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::AnnounceSelf)
}

/// `after` is the last interface id of the previous page, or empty for the first page.
#[wasm_bindgen(js_name = rcRequestInventoryInterfaces)]
pub fn rc_request_inventory_interfaces(after: &[u8]) -> Result<Vec<u8>, JsValue> {
    let page = if after.is_empty() {
        RemoteControlInterfacePage::First
    } else {
        RemoteControlInterfacePage::After(RemoteControlInterfaceCursor::after(interface(after)?))
    };
    encode(RemoteControlRequest::InventoryInterfaces { page })
}

#[wasm_bindgen(js_name = rcRequestInventoryInterfaceConfig)]
pub fn rc_request_inventory_interface_config(id: &[u8]) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::InventoryInterfaceConfig { id: interface(id)? })
}

#[wasm_bindgen(js_name = rcRequestInventoryInterfacePeers)]
pub fn rc_request_inventory_interface_peers(id: &[u8], after: &[u8]) -> Result<Vec<u8>, JsValue> {
    let page = if after.is_empty() {
        RemoteControlPeerPage::First
    } else {
        RemoteControlPeerPage::After(RemoteControlPeerCursor::after(interface(after)?))
    };
    encode(RemoteControlRequest::InventoryInterfacePeers {
        id: interface(id)?,
        page,
    })
}

#[wasm_bindgen(js_name = rcRequestSetInterfacePower)]
pub fn rc_request_set_interface_power(id: &[u8], on: bool) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::SetInterfacePower {
        id: interface(id)?,
        power: if on {
            RemoteControlInterfacePower::On
        } else {
            RemoteControlInterfacePower::Off
        },
    })
}

#[wasm_bindgen(js_name = rcRequestSetInterfaceMode)]
pub fn rc_request_set_interface_mode(id: &[u8], mode: &str) -> Result<Vec<u8>, JsValue> {
    let mode = InterfaceMode::ALL
        .into_iter()
        .find(|candidate| format!("{candidate:?}").eq_ignore_ascii_case(mode))
        .ok_or_else(|| error(format!("unknown interface mode `{mode}`")))?;
    encode(RemoteControlRequest::SetInterfaceMode {
        id: interface(id)?,
        mode,
    })
}

#[wasm_bindgen(js_name = rcInterfaceModes)]
pub fn rc_interface_modes() -> Array {
    InterfaceMode::ALL
        .into_iter()
        .map(|mode| JsValue::from_str(&format!("{mode:?}")))
        .collect()
}

#[wasm_bindgen(js_name = rcRequestSetInterfaceGroup)]
pub fn rc_request_set_interface_group(id: &[u8], group: &str) -> Result<Vec<u8>, JsValue> {
    let group = RemoteControlInterfaceGroup::parse(group)
        .ok_or_else(|| error(format!("invalid group `{group}`")))?;
    encode(RemoteControlRequest::SetInterfaceGroup {
        id: interface(id)?,
        group,
    })
}

#[wasm_bindgen(js_name = rcRequestInventoryInterfaceDiscoveryGroups)]
pub fn rc_request_inventory_interface_discovery_groups(id: &[u8]) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::InventoryInterfaceDiscoveryGroups { id: interface(id)? })
}

#[wasm_bindgen(js_name = rcRequestReplaceInterfaceDiscoveryGroups)]
pub fn rc_request_replace_interface_discovery_groups(
    id: &[u8],
    groups: Vec<String>,
) -> Result<Vec<u8>, JsValue> {
    let parsed = groups
        .iter()
        .map(|group| {
            DiscoveryGroupId::parse(group)
                .map_err(|failure| error(format!("invalid group `{group}`: {failure:?}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let set = DiscoveryGroupSet::try_from_slice(&parsed)
        .map_err(|failure| error(format!("discovery groups: {failure:?}")))?;
    encode(RemoteControlRequest::ReplaceInterfaceDiscoveryGroups {
        id: interface(id)?,
        groups: RemoteControlDiscoveryGroups::new(set),
    })
}

/// `profile` is the inventory text form: `LoRa,<region>,<hz>,<sf>,<bw kHz>,<cr>,<dBm>,<preamble>`.
#[wasm_bindgen(js_name = rcRequestSetInterfaceLoRaProfile)]
pub fn rc_request_set_interface_lora_profile(id: &[u8], profile: &str) -> Result<Vec<u8>, JsValue> {
    let profile = RemoteControlLoRaProfile::parse(profile)
        .ok_or_else(|| error("the LoRa profile is outside what the firmware accepts"))?;
    encode(RemoteControlRequest::SetInterfaceLoRaProfile {
        id: interface(id)?,
        profile,
    })
}

#[wasm_bindgen(js_name = rcLoRaRegions)]
pub fn rc_lora_regions() -> Array {
    personal_rns::interfaces::subghz::RegulatoryRegion::ALL
        .into_iter()
        .map(|region| JsValue::from_str(region.label()))
        .chain([JsValue::from_str("Custom")])
        .collect()
}

#[wasm_bindgen(js_name = rcRequestSetSystemPower)]
pub fn rc_request_set_system_power(awake: bool) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::SetSystemPower {
        power: if awake {
            RemoteControlSystemPower::Awake
        } else {
            RemoteControlSystemPower::Asleep
        },
    })
}

#[wasm_bindgen(js_name = rcRequestSleepRadios)]
pub fn rc_request_sleep_radios() -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::SleepRadios)
}

#[wasm_bindgen(js_name = rcRequestWakeRadios)]
pub fn rc_request_wake_radios() -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::WakeRadios)
}

#[wasm_bindgen(js_name = rcRequestSetGnssPower)]
pub fn rc_request_set_gnss_power(on: bool) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::SetGnssPower {
        power: if on {
            RemoteControlGnssPower::On
        } else {
            RemoteControlGnssPower::Off
        },
    })
}

#[wasm_bindgen(js_name = rcRequestSetDisplayVisibility)]
pub fn rc_request_set_display_visibility(visible: bool) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::SetDisplayVisibility {
        visibility: if visible {
            RemoteControlDisplayVisibility::Visible
        } else {
            RemoteControlDisplayVisibility::Hidden
        },
    })
}

#[wasm_bindgen(js_name = rcRequestSetDisplayAutoOff)]
pub fn rc_request_set_display_auto_off(enabled: bool) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::SetDisplayAutoOff {
        auto_off: if enabled {
            RemoteControlDisplayAutoOff::Enabled
        } else {
            RemoteControlDisplayAutoOff::Disabled
        },
    })
}

/// `after` is the last controller identity hash of the previous page, or empty for the first.
#[wasm_bindgen(js_name = rcRequestInventoryControllers)]
pub fn rc_request_inventory_controllers(after: &[u8]) -> Result<Vec<u8>, JsValue> {
    let page = if after.is_empty() {
        RemoteControlControllerPage::First
    } else {
        RemoteControlControllerPage::After(RemoteControlControllerCursor::after(IdentityHash::new(
            fixed(after, "controller hash")?,
        )))
    };
    encode(RemoteControlRequest::InventoryControllers { page })
}

/// Grants another controller full control. `public_key` is its 64-byte public key.
#[wasm_bindgen(js_name = rcRequestAuthorizeController)]
pub fn rc_request_authorize_controller(public_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let controller = parse_controller_public_keys(public_key).ok_or_else(|| {
        error(format!(
            "public key must be {IDENTITY_PUBLIC_KEY_LEN} bytes"
        ))
    })?;
    encode(RemoteControlRequest::AuthorizeController {
        controller,
        permitted_requests: RemoteControlRequestSet::all(),
    })
}

#[wasm_bindgen(js_name = rcRequestRevokeController)]
pub fn rc_request_revoke_controller(hash: &[u8]) -> Result<Vec<u8>, JsValue> {
    encode(RemoteControlRequest::RevokeController {
        hash: IdentityHash::new(fixed(hash, "controller hash")?),
    })
}

// ---- responses -------------------------------------------------------------------------------

fn outcome(kind: &str, value: impl core::fmt::Debug) -> Object {
    let object = Object::new();
    set(&object, "kind", kind);
    set(&object, "outcome", format!("{value:?}"));
    object
}

/// Decode any Remote Control response into `{ kind, ... }`.
#[wasm_bindgen(js_name = rcDecodeResponse)]
pub fn rc_decode_response(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let response = RemoteControlResponse::parse(bytes)
        .map_err(|failure| error(format!("response could not be parsed: {failure:?}")))?;
    let object = match response {
        RemoteControlResponse::Describe(description) => {
            let object = Object::new();
            set(&object, "kind", "Describe");
            let requests: Array = description
                .available_requests()
                .iter()
                .map(|kind| JsValue::from_str(&format!("{kind:?}")))
                .collect();
            set(&object, "requests", requests);
            object
        }
        RemoteControlResponse::DescribeBuild(build) => {
            let object = Object::new();
            set(&object, "kind", "DescribeBuild");
            set(&object, "version", build.as_str());
            object
        }
        RemoteControlResponse::DescribePower(power) => {
            let object = Object::new();
            set(&object, "kind", "DescribePower");
            set(
                &object,
                "battery",
                power
                    .battery()
                    .map_or(JsValue::NULL, |percent| JsValue::from(percent.get())),
            );
            set(
                &object,
                "externalPower",
                format!("{:?}", power.external_power()),
            );
            set(&object, "detail", format!("{power:?}"));
            object
        }
        RemoteControlResponse::AnnounceSelf(value) => outcome("AnnounceSelf", value),
        RemoteControlResponse::InventoryInterfaces(inventory) => {
            let object = Object::new();
            set(&object, "kind", "InventoryInterfaces");
            let entries: Array = inventory
                .entries()
                .iter()
                .map(|entry| {
                    let item = Object::new();
                    set(&item, "id", hex(entry.id.as_bytes()));
                    set(&item, "interfaceKind", format!("{:?}", entry.kind));
                    set(&item, "mode", format!("{:?}", entry.mode));
                    set(&item, "connection", format!("{:?}", entry.connection));
                    set(&item, "enabled", entry.enabled);
                    set(&item, "txBytes", entry.tx_bytes as f64);
                    set(&item, "rxBytes", entry.rx_bytes as f64);
                    set(&item, "links", entry.links);
                    set(
                        &item,
                        "rateBytesPerSec",
                        entry
                            .rate_bytes_per_sec
                            .map_or(JsValue::NULL, |rate| JsValue::from(rate.get())),
                    );
                    JsValue::from(item)
                })
                .collect();
            set(&object, "entries", entries);
            set(
                &object,
                "after",
                match inventory.continuation() {
                    RemoteControlInterfaceContinuation::Complete => JsValue::NULL,
                    RemoteControlInterfaceContinuation::More(cursor) => {
                        JsValue::from_str(&hex(cursor.id().as_bytes()))
                    }
                },
            );
            object
        }
        RemoteControlResponse::InventoryInterfaceConfig(config) => {
            let object = Object::new();
            set(&object, "kind", "InventoryInterfaceConfig");
            match config {
                RemoteControlInterfaceConfigOutcome::Card(card) => {
                    set(&object, "status", "Card");
                    set(&object, "name", card.name.as_str());
                    set(&object, "group", card.group.as_str());
                    set(&object, "config", card.config.as_str());
                    set(&object, "failure", card.failure.as_str());
                    set(&object, "destinations", card.destinations);
                    set(&object, "transportedLinks", card.transported_links);
                }
                RemoteControlInterfaceConfigOutcome::UnknownInterface => {
                    set(&object, "status", "UnknownInterface");
                }
            }
            object
        }
        RemoteControlResponse::InventoryInterfacePeers(peers) => {
            let object = Object::new();
            set(&object, "kind", "InventoryInterfacePeers");
            match peers {
                RemoteControlInterfacePeersOutcome::Page(page) => {
                    set(&object, "status", "Page");
                    let entries: Array = page
                        .peers
                        .iter()
                        .map(|peer| {
                            let item = Object::new();
                            set(&item, "id", hex(peer.id.as_bytes()));
                            set(&item, "connection", format!("{:?}", peer.connection));
                            set(&item, "txBytes", peer.tx_bytes as f64);
                            set(&item, "rxBytes", peer.rx_bytes as f64);
                            set(&item, "links", peer.links);
                            set(&item, "destinations", peer.destinations);
                            set(&item, "radio", format!("{:?}", peer.radio));
                            set(&item, "details", format!("{:?}", peer.details));
                            JsValue::from(item)
                        })
                        .collect();
                    set(&object, "peers", entries);
                    set(
                        &object,
                        "after",
                        match page.continuation() {
                            RemoteControlPeerContinuation::Complete => JsValue::NULL,
                            RemoteControlPeerContinuation::More(cursor) => {
                                JsValue::from_str(&hex(cursor.id().as_bytes()))
                            }
                        },
                    );
                }
                RemoteControlInterfacePeersOutcome::UnknownInterface => {
                    set(&object, "status", "UnknownInterface");
                }
            }
            object
        }
        RemoteControlResponse::InventoryInterfaceDiscoveryGroups(groups) => {
            let object = Object::new();
            set(&object, "kind", "InventoryInterfaceDiscoveryGroups");
            match groups {
                RemoteControlDiscoveryGroupsInventoryOutcome::Groups(groups) => {
                    set(&object, "status", "Groups");
                    let names: Array = groups
                        .groups()
                        .iter()
                        .map(|group| JsValue::from_str(group.as_str()))
                        .collect();
                    set(&object, "groups", names);
                }
                other => set(&object, "status", format!("{other:?}")),
            }
            object
        }
        RemoteControlResponse::InventoryControllers(inventory) => {
            let object = Object::new();
            set(&object, "kind", "InventoryControllers");
            let hashes: Array = inventory
                .hashes()
                .iter()
                .map(|hash| JsValue::from_str(&hex(hash.as_bytes())))
                .collect();
            set(&object, "controllers", hashes);
            set(
                &object,
                "after",
                match inventory.continuation() {
                    RemoteControlControllerContinuation::Complete => JsValue::NULL,
                    RemoteControlControllerContinuation::More(cursor) => {
                        JsValue::from_str(&hex(cursor.identity().as_bytes()))
                    }
                },
            );
            object
        }
        RemoteControlResponse::SetInterfacePower(value) => outcome("SetInterfacePower", value),
        RemoteControlResponse::SetInterfaceMode(value) => outcome("SetInterfaceMode", value),
        RemoteControlResponse::SetInterfaceGroup(value) => outcome("SetInterfaceGroup", value),
        RemoteControlResponse::ReplaceInterfaceDiscoveryGroups(value) => {
            outcome("ReplaceInterfaceDiscoveryGroups", value)
        }
        RemoteControlResponse::SetInterfaceLoRaProfile(value) => {
            outcome("SetInterfaceLoRaProfile", value)
        }
        RemoteControlResponse::AuthorizeController(value) => outcome("AuthorizeController", value),
        RemoteControlResponse::RevokeController(value) => outcome("RevokeController", value),
        RemoteControlResponse::SleepRadios(value) => outcome("SleepRadios", value),
        RemoteControlResponse::WakeRadios(value) => outcome("WakeRadios", value),
        RemoteControlResponse::SetSystemPower(value) => outcome("SetSystemPower", value),
        RemoteControlResponse::SetGnssPower(value) => outcome("SetGnssPower", value),
        RemoteControlResponse::SetDisplayVisibility(value) => {
            outcome("SetDisplayVisibility", value)
        }
        RemoteControlResponse::SetDisplayAutoOff(value) => outcome("SetDisplayAutoOff", value),
        RemoteControlResponse::ProtocolError(value) => outcome("ProtocolError", value),
        other => {
            let object = Object::new();
            set(&object, "kind", "Other");
            set(&object, "detail", format!("{other:?}"));
            object
        }
    };
    Ok(object.into())
}

// ---- LoRa profile helpers --------------------------------------------------------------------

fn profile_object(profile: personal_rns::interfaces::lora::RadioProfile) -> Object {
    use personal_rns::interfaces::lora::{ModemPreset, Modulation};
    use personal_rns::interfaces::subghz::SubGRegion;
    let object = Object::new();
    set(
        &object,
        "region",
        match profile.region() {
            SubGRegion::Regulated(region) => region.label(),
            SubGRegion::Custom => "Custom",
        },
    );
    set(&object, "frequencyHz", profile.frequency().hz());
    let Modulation::Lora {
        spreading_factor,
        bandwidth,
        coding_rate,
    } = profile.modulation();
    set(&object, "spreadingFactor", spreading_factor as u8);
    set(&object, "bandwidthKhz", bandwidth.hz() / 1_000);
    set(&object, "codingRate", coding_rate.denominator());
    set(&object, "txPowerDbm", profile.tx_power().dbm());
    set(&object, "preamble", profile.preamble().count());
    set(
        &object,
        "preset",
        ModemPreset::matching(profile.modulation())
            .map_or(JsValue::NULL, |preset| preset.label().into()),
    );
    object
}

/// Decode an interface config string (compact `L,...` or verbose `LoRa,...`), or `null`.
#[wasm_bindgen(js_name = rcParseLoRaConfig)]
pub fn rc_parse_lora_config(text: &str) -> JsValue {
    personal_rns::interfaces::lora::RadioProfile::parse_inventory_config(text)
        .map_or(JsValue::NULL, |profile| profile_object(profile).into())
}

/// The region's built-in Auto LoRa profile, or `null` when the region has none.
#[wasm_bindgen(js_name = rcRegionAutoProfile)]
pub fn rc_region_auto_profile(label: &str) -> JsValue {
    use personal_rns::interfaces::subghz::{
        RegulatoryRegion, ResolvedSubGMode, SubGConfiguration, SubGRegion,
    };
    let region = if label.eq_ignore_ascii_case("custom") {
        SubGRegion::Custom
    } else {
        match RegulatoryRegion::ALL
            .into_iter()
            .find(|region| region.label().eq_ignore_ascii_case(label))
        {
            Some(region) => SubGRegion::Regulated(region),
            None => return JsValue::NULL,
        }
    };
    match SubGConfiguration::auto_lora_for(region) {
        Ok(configuration) => {
            let ResolvedSubGMode::LoRa(profile) = configuration.resolve();
            profile_object(profile).into()
        }
        Err(_) => JsValue::NULL,
    }
}

/// The named modem presets as `{ label, spreadingFactor, bandwidthKhz, codingRate }`.
#[wasm_bindgen(js_name = rcLoRaPresets)]
pub fn rc_lora_presets() -> Array {
    use personal_rns::interfaces::lora::{ModemPreset, Modulation};
    ModemPreset::ALL
        .into_iter()
        .map(|preset| {
            let object = Object::new();
            set(&object, "label", preset.label());
            let Modulation::Lora {
                spreading_factor,
                bandwidth,
                coding_rate,
            } = preset.modulation();
            set(&object, "spreadingFactor", spreading_factor as u8);
            set(&object, "bandwidthKhz", bandwidth.hz() / 1_000);
            set(&object, "codingRate", coding_rate.denominator());
            JsValue::from(object)
        })
        .collect()
}
