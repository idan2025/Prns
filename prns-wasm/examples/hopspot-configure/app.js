// Hopspot Configure: set up and control a screenless Personal Hopspot over USB.
//
// The browser runs a real PRNS node in WebAssembly. Its identity is this browser's owner key.
// Setting up a board writes a UF2 that both flashes the firmware and installs that owner key on
// the board, so afterwards only this browser (and controllers it authorizes) can configure it.
// Every board operation is a Remote Control request; the wire format lives in Rust (`rc*`).

import {
  BrowserLocalStorageIdentityStore,
  Prns,
  destinationHash,
  identityHash,
  requestPathHash,
} from "./sdk/index.js";
import initWasm, * as rc from "./pkg/prns_wasm.js";

const IDENTITY_KEY = "prns.hopspot-configure.identity.v1";
const BOARDS_KEY = "prns.hopspot-configure.boards.v1";
// Boards the setup wizard can flash. `ownerPage` is the memory profile's remote-control-identity
// page, where the setup image writes the board's key and its owner; `drive` is the bootloader
// drive's name, for the instructions.
const BOARD_TYPES = {
  rak4631: {
    label: "RAK WisBlock 4631",
    firmware: "./firmware/rak4631.uf2",
    ownerPage: 0xe2000,
    drive: "RAK4631",
    reset: "Double-press its RESET button",
  },
  "wio-tracker-l1": {
    label: "Seeed Wio Tracker L1",
    firmware: "./firmware/wio-tracker-l1.uf2",
    ownerPage: 0xe1000,
    drive: "TRACKER L1",
    reset: "Double-press its RESET button",
  },
  "xiao-nrf52840": {
    label: "Seeed XIAO nRF52840 with Wio-SX1262",
    firmware: "./firmware/xiao-nrf52840.uf2",
    ownerPage: 0xe1000,
    drive: "XIAO-SENSE",
    reset: "Double-tap its tiny RESET button",
  },
};
// A running Hopspot restarts into its UF2 bootloader when sent this vendor request (prns-core
// `BOOTLOADER_ENTRY_CONTROL_*`), so updating a board needs no button presses.
const HOPSPOT_USB = { vendorId: 0x1209, productId: 0x0001 };
const BOOTLOADER_ENTRY = { requestType: "vendor", recipient: "device", request: 0x50, value: 0x5052, index: 0x4e53 };
const UF2_FAMILY_NRF52840 = 0xada52840;
const REFRESH_MS = 5000;

const app = document.getElementById("app");
const runtimeBadge = document.getElementById("runtime");

// ---------- small helpers ----------

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (text) => {
  const clean = text.trim().toLowerCase().replace(/^0x/, "").replace(/[^0-9a-f]/g, "");
  if (clean.length % 2) throw new Error("hex text has an odd number of digits");
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => parseInt(pair, 16));
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const bytesText = (n) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toast(message, kind = "info") {
  const node = h("div", { class: "toast", dataset: { kind } }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), kind === "bad" ? 6000 : 3000);
}

function describe(outcome) {
  if (!outcome || typeof outcome !== "object") return String(outcome);
  const data = outcome.data && typeof outcome.data === "object" ? outcome.data : null;
  const inner = data && data.tag ? `: ${data.tag}` : "";
  return `${outcome.tag ?? "Unknown"}${inner}`;
}

/// Run an async action from a button, disabling it until it settles.
async function busy(button, action) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  try {
    await action();
  } catch (error) {
    toast(error.message ?? String(error), "bad");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function friendlyOutcome(result) {
  const text = result.outcome ?? result.status ?? "";
  const words = {
    Applied: "Saved",
    Unchanged: "Already set",
    Scheduled: "Applying now",
    Announced: "Announced",
  };
  return words[text] ?? text;
}

function expectApplied(result, what) {
  const ok = ["Applied", "Unchanged", "Scheduled", "Announced"];
  if (result.kind === "ProtocolError") throw new Error(`${what}: the board refused (${result.outcome})`);
  if (!ok.includes(result.outcome)) throw new Error(`${what}: ${result.outcome}`);
  toast(`${what}: ${friendlyOutcome(result)}`);
}

// ---------- local state ----------

const boards = {
  list() {
    try {
      return JSON.parse(localStorage.getItem(BOARDS_KEY) ?? "[]");
    } catch {
      return [];
    }
  },
  save(list) {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(list));
  },
  add(board) {
    const list = boards.list().filter((b) => b.targetPublicKey !== board.targetPublicKey);
    list.push(board);
    boards.save(list);
  },
  remove(targetPublicKey) {
    boards.save(boards.list().filter((b) => b.targetPublicKey !== targetPublicKey));
  },
};

// ---------- UF2 provisioning ----------

function uf2Block(address, payload, index, total) {
  const block = new Uint8Array(512);
  const view = new DataView(block.buffer);
  const words = [0x0a324655, 0x9e5d5157, 0x00002000, address, 256, index, total, UF2_FAMILY_NRF52840];
  words.forEach((word, i) => view.setUint32(i * 4, word >>> 0, true));
  block.set(payload, 32);
  view.setUint32(508, 0x0ab16f30, true);
  return block;
}

/// Append the owner vault page to a firmware UF2 and renumber every block as one transfer.
function mergeUf2(firmware, pageAddress, page) {
  if (firmware.length === 0 || firmware.length % 512) throw new Error("firmware UF2 is malformed");
  const payloads = [];
  const view = new DataView(firmware.buffer, firmware.byteOffset, firmware.byteLength);
  for (let offset = 0; offset < firmware.length; offset += 512) {
    if (view.getUint32(offset, true) !== 0x0a324655 || view.getUint32(offset + 508, true) !== 0x0ab16f30)
      throw new Error("firmware UF2 has a bad block");
    if (view.getUint32(offset + 28, true) !== UF2_FAMILY_NRF52840) throw new Error("not an nRF52840 UF2");
    const address = view.getUint32(offset + 12, true);
    const size = view.getUint32(offset + 16, true);
    if (address < pageAddress + page.length && address + size > pageAddress)
      throw new Error("firmware overlaps the owner key page");
    payloads.push([address, firmware.slice(offset + 32, offset + 32 + size)]);
  }
  for (let offset = 0; offset < page.length; offset += 256) {
    payloads.push([pageAddress + offset, page.slice(offset, offset + 256)]);
  }
  const merged = new Uint8Array(payloads.length * 512);
  payloads.forEach(([address, payload], index) =>
    merged.set(uf2Block(address, payload, index, payloads.length), index * 512),
  );
  return merged;
}

/// Check a plain firmware UF2 before an update: right chip, and it leaves the owner page alone,
/// so the board keeps its identity, owner, name and settings.
function checkFirmware(firmware, ownerPage) {
  if (firmware.length === 0 || firmware.length % 512) throw new Error("firmware UF2 is malformed");
  const view = new DataView(firmware.buffer, firmware.byteOffset, firmware.byteLength);
  for (let offset = 0; offset < firmware.length; offset += 512) {
    if (view.getUint32(offset + 28, true) !== UF2_FAMILY_NRF52840) throw new Error("not an nRF52840 UF2");
    const address = view.getUint32(offset + 12, true);
    if (address + view.getUint32(offset + 16, true) > ownerPage) throw new Error("this firmware would overwrite the board's settings");
  }
  return firmware;
}

async function fetchFirmware(type) {
  const response = await fetch(BOARD_TYPES[type].firmware, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not download the ${BOARD_TYPES[type].label} firmware (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/// Restart the plugged-in Hopspot into its update (UF2 bootloader) mode. Returns false when no
/// running Hopspot was chosen, for example a new board that still runs its factory firmware.
async function restartIntoUpdateMode() {
  if (session) {
    session.close();
    session = null;
  }
  await controller.disconnectUsb();
  let devices = (await navigator.usb.getDevices()).filter(
    (device) => device.vendorId === HOPSPOT_USB.vendorId && device.productId === HOPSPOT_USB.productId,
  );
  if (devices.length === 0) {
    try {
      devices = [await navigator.usb.requestDevice({ filters: [HOPSPOT_USB] })];
    } catch {
      return false;
    }
  }
  if (devices.length > 1) throw new Error("More than one Hopspot is plugged in. Unplug all but the one to update.");
  const [device] = devices;
  if (!device.opened) await device.open();
  try {
    await device.controlTransferOut(BOOTLOADER_ENTRY);
  } catch {
    // The board resets while answering, so the transfer may report an error.
  }
  try {
    await device.close();
  } catch {
    // Already gone.
  }
  return true;
}

/// The three steps every flash shares: get the board into update mode, write the image to its
/// drive, wait for it to restart. `image()` builds the bytes when the user clicks Write.
function flashSteps(type, { image, fileName, writeLabel, onWritten }) {
  const board = BOARD_TYPES[type];
  const state = h("p", { class: "muted small" });
  const write = async (direct) => {
    const bytes = await image();
    let written = false;
    try {
      if (direct) {
        state.textContent = `Pick the ${board.drive} drive in the window that opens…`;
        written = await writeToDrive(bytes, "hopspot.uf2");
      }
      if (!written) {
        download(bytes, fileName);
        state.textContent = `Downloaded ${fileName}. Drag it onto the ${board.drive} drive, then delete the file.`;
      } else {
        state.textContent = "Written. The board restarts by itself; give it a few seconds.";
      }
    } catch (error) {
      if (error.name === "AbortError") {
        state.textContent = "Cancelled.";
        return;
      }
      throw error;
    } finally {
      bytes.fill(0);
    }
    onWritten?.(written);
  };
  return h(
    "div",
    {},
    h(
      "ol",
      { class: "steps" },
      h("li", {}, `Plug the ${board.label} into this computer with a USB cable.`),
      h(
        "li",
        {},
        "Put it in update mode: ",
        h(
          "button",
          {
            onclick: (e) =>
              busy(e.currentTarget, async () => {
                state.textContent = "Asking the board to restart…";
                state.textContent = (await restartIntoUpdateMode())
                  ? `Restarting. A drive called ${board.drive} appears in a few seconds.`
                  : `No running Hopspot was picked. ${board.reset}; a drive called ${board.drive} appears.`;
              }),
          },
          "Restart into update mode",
        ),
        h("div", { class: "muted small" }, `New board, or the button does nothing? ${board.reset} instead. A drive called ${board.drive} appears.`),
      ),
      h(
        "li",
        {},
        h("button", { class: "primary", onclick: (e) => busy(e.currentTarget, () => write(true)) }, writeLabel),
        " ",
        h("button", { onclick: (e) => busy(e.currentTarget, () => write(false)) }, "Download file instead"),
        h("div", { class: "muted small" }, `Choose the ${board.drive} drive when asked. Your browser may ask to allow editing it; allow it.`),
      ),
    ),
    state,
  );
}

async function writeToDrive(bytes, fileName) {
  if (!("showDirectoryPicker" in window)) return false;
  const directory = await window.showDirectoryPicker({ id: "hopspot-uf2", mode: "readwrite" });
  const file = await directory.getFileHandle(fileName, { create: true });
  const stream = await file.createWritable();
  await stream.write(bytes);
  await stream.close();
  return true;
}

function download(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = h("a", { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- the browser node and a board session ----------

class Controller {
  constructor(prns, secret) {
    this.prns = prns;
    this.publicKey = rc.rcIdentityPublicKey(secret);
    this.hash = rc.rcIdentityHash(this.publicKey);
    this.path = requestPathHash(rc.rcRequestPathHash());
    this.usb = null;
  }

  async connectUsb() {
    if (this.usb) return;
    const outcome = await this.prns.interfaces.usbAuto.connect();
    if (outcome.tag !== "Connected") throw new Error(`USB: ${describe(outcome)}`);
    this.usb = outcome.data;
  }

  async disconnectUsb() {
    const usb = this.usb;
    this.usb = null;
    await usb?.close?.();
  }

  async open(board, onStage) {
    const endpoint = destinationHash(rc.rcTargetEndpoint(unhex(board.targetPublicKey)));
    onStage("Looking for the board over USB…");
    let found = null;
    for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
      const path = await this.prns.requestPath(endpoint);
      if (path.tag === "Succeeded") found = path;
      else await sleep(750);
    }
    if (!found)
      throw new Error(
        "The board did not answer. Check that this board is the one plugged in. If it was set up again somewhere else (another browser, or the usb_config tool), it has a new identity: add it again with its key, or set it up again here.",
      );
    onStage("Opening a secure link…");
    const link = await this.prns.establishLink(endpoint);
    if (link.tag !== "Succeeded") throw new Error(`Link: ${describe(link)}`);
    const linkId = link.data.data.linkId;
    onStage("Proving this browser is the owner…");
    const identified = await this.prns.identify(linkId, identityHash(this.hash));
    if (identified.tag !== "Succeeded") throw new Error(`Identify: ${describe(identified)}`);
    return new Session(this, linkId);
  }
}

class Session {
  constructor(controller, linkId) {
    this.controller = controller;
    this.linkId = linkId;
    this.closed = false;
  }

  async call(request) {
    const outcome = await this.controller.prns.request(this.linkId, this.controller.path, request);
    if (outcome.tag !== "Succeeded") throw new Error(`Request failed: ${describe(outcome)}`);
    return rc.rcDecodeResponse(outcome.data.data.data);
  }

  async interfaces() {
    const all = [];
    let after = new Uint8Array();
    for (let page = 0; page < 64; page += 1) {
      const result = await this.call(rc.rcRequestInventoryInterfaces(after));
      if (result.kind !== "InventoryInterfaces") throw new Error(`Interfaces: ${result.outcome ?? result.kind}`);
      all.push(...result.entries);
      if (!result.after) break;
      after = unhex(result.after);
    }
    return all;
  }

  async peers(id) {
    const all = [];
    let after = new Uint8Array();
    for (let page = 0; page < 64; page += 1) {
      const result = await this.call(rc.rcRequestInventoryInterfacePeers(unhex(id), after));
      if (result.status !== "Page") return all;
      all.push(...result.peers);
      if (!result.after) break;
      after = unhex(result.after);
    }
    return all;
  }

  async controllers() {
    const all = [];
    let after = new Uint8Array();
    for (let page = 0; page < 64; page += 1) {
      const result = await this.call(rc.rcRequestInventoryControllers(after));
      if (result.kind !== "InventoryControllers") throw new Error(`Controllers: ${result.outcome ?? result.kind}`);
      all.push(...result.controllers);
      if (!result.after) break;
      after = unhex(result.after);
    }
    return all;
  }

  close() {
    this.closed = true;
    void this.controller.prns.closeLink?.(this.linkId);
  }
}

// ---------- screens ----------

let controller;
let session = null;
let refreshTimer = null;

function render(...cards) {
  app.replaceChildren(...cards);
}

function homeScreen() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  const list = boards.list();
  const ownerCard = h(
    "section",
    { class: "card" },
    h("h2", {}, "This browser's owner key"),
    h(
      "p",
      { class: "muted small" },
      "Boards you set up here trust this key. It lives only in this browser: back it up, or you will need to set the board up again if browser data is cleared.",
    ),
    h("div", { class: "mono" }, `ID ${hex(controller.hash)}`),
    h(
      "div",
      { class: "row" },
      h("button", { onclick: exportBackup }, "Download backup"),
      h("button", { onclick: importBackup }, "Restore backup"),
      h("button", { onclick: () => navigator.clipboard.writeText(hex(controller.publicKey)).then(() => toast("Public key copied")) }, "Copy public key"),
    ),
  );
  const boardCards = list.map((board) =>
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "row spread" },
        h("h2", {}, board.name),
        h("span", { class: "pill" }, BOARD_TYPES[board.board]?.label ?? "Hopspot"),
      ),
      h("p", { class: "muted small" }, "Plug the board into this computer with a USB cable, then connect."),
      h(
        "div",
        { class: "row" },
        h("button", { class: "primary", onclick: (event) => busy(event.currentTarget, () => connectScreen(board)) }, "Connect"),
        h("button", { onclick: () => updateScreen(board) }, "Update firmware"),
        h("button", { onclick: () => renameBoard(board) }, "Rename"),
        h("button", { class: "danger", onclick: () => forgetBoard(board) }, "Forget"),
      ),
    ),
  );
  render(
    ...boardCards,
    setupCard(list.length === 0),
    h(
      "details",
      { class: "card" },
      h("summary", {}, "Add a board this key already controls"),
      addExistingForm(),
    ),
    ownerCard,
  );
}

function setupCard(open) {
  const type = h(
    "select",
    { "aria-label": "Board type" },
    Object.entries(BOARD_TYPES).map(([value, board]) => h("option", { value }, board.label)),
  );
  const name = h("input", { value: "My Hopspot", "aria-label": "Board name" });
  const region = h(
    "select",
    { "aria-label": "Radio region" },
    h("option", { value: "" }, "Choose later"),
    rc.rcLoRaRegions()
      .filter((label) => label !== "Custom")
      .map((label) => h("option", { value: label }, rc.rcRegionAutoProfile(label) ? label : `${label} (pick the frequency after setup)`)),
  );
  const steps = h("div", {});
  const drawSteps = () =>
    steps.replaceChildren(
      flashSteps(type.value, {
        fileName: `${type.value}-hopspot-setup.uf2`,
        writeLabel: `Set up the ${BOARD_TYPES[type.value].drive} drive`,
        image: () => provisionImage(type.value, name.value, region.value),
        onWritten: (written) => setTimeout(homeScreen, written ? 2500 : 8000),
      }),
    );
  type.addEventListener("change", drawSteps);
  drawSteps();
  const body = h(
    "div",
    { class: "card" },
    h("h2", {}, "Set up a new board"),
    h(
      "div",
      { class: "fields" },
      h("label", { class: "field" }, "Board", type),
      h("label", { class: "field" }, "Name (shown to other apps)", name),
      h("label", { class: "field" }, "Radio region (where you are)", region),
    ),
    steps,
    h(
      "p",
      { class: "muted small" },
      "Setup erases what is on the board and installs Personal Hopspot with this browser as its owner. After that, change settings here at any time without setting it up again.",
    ),
  );
  return open ? body : h("details", { class: "card" }, h("summary", {}, "Set up a new board"), body);
}

/// Build the setup image: the firmware plus a fresh board key that trusts this browser, and
/// remember the board so Connect can find it.
async function provisionImage(type, name, region) {
  const firmware = await fetchFirmware(type);
  const targetSecret = crypto.getRandomValues(new Uint8Array(64));
  const targetPublicKey = rc.rcIdentityPublicKey(targetSecret);
  const page = rc.rcVaultPage(targetSecret, controller.publicKey);
  targetSecret.fill(0);
  const merged = mergeUf2(firmware, BOARD_TYPES[type].ownerPage, page);
  page.fill(0);
  const label = name.trim() || "My Hopspot";
  boards.add({
    name: label,
    board: type,
    targetPublicKey: hex(targetPublicKey),
    addedAt: new Date().toISOString(),
    pendingName: label,
    pendingRegion: region || undefined,
  });
  return merged;
}

function updateScreen(board) {
  const type = h(
    "select",
    { "aria-label": "Board type" },
    Object.entries(BOARD_TYPES).map(([value, info]) => h("option", { value, selected: value === board.board }, info.label)),
  );
  const steps = h("div", {});
  const drawSteps = () =>
    steps.replaceChildren(
      flashSteps(type.value, {
        fileName: `${type.value}-hopspot-update.uf2`,
        writeLabel: "Write the update",
        image: async () => checkFirmware(await fetchFirmware(type.value), BOARD_TYPES[type.value].ownerPage),
        onWritten: () => {
          if (!BOARD_TYPES[board.board]) boards.add({ ...board, board: type.value });
        },
      }),
    );
  type.addEventListener("change", drawSteps);
  drawSteps();
  render(
    h(
      "section",
      { class: "card" },
      h("div", { class: "row spread" }, h("h2", {}, `Update ${board.name}`), h("button", { onclick: () => homeScreen() }, "Back")),
      h("p", { class: "muted small" }, "Installs the newest firmware. The board keeps its name, owner, radio settings and everything it learned."),
      !BOARD_TYPES[board.board] && h("label", { class: "field" }, "Board type", type),
      steps,
    ),
  );
}

function addExistingForm() {
  const name = h("input", { value: "My Hopspot" });
  const key = h("input", { placeholder: "128 hex digits", class: "mono" });
  return h(
    "div",
    { class: "card" },
    h(
      "p",
      { class: "muted small" },
      "For a board set up elsewhere (for example with the usb_config tool) that has authorized this browser's public key. Paste the board's public key.",
    ),
    h("div", { class: "fields" }, h("label", { class: "field" }, "Name", name), h("label", { class: "field" }, "Board public key", key)),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          onclick: () => {
            try {
              const bytes = unhex(key.value);
              rc.rcTargetEndpoint(bytes);
              boards.add({ name: name.value.trim() || "My Hopspot", board: "hopspot", targetPublicKey: hex(bytes), addedAt: new Date().toISOString() });
              homeScreen();
            } catch (error) {
              toast(error.message ?? String(error), "bad");
            }
          },
        },
        "Add board",
      ),
    ),
  );
}

function renameBoard(board) {
  const name = prompt("New name", board.name);
  if (!name) return;
  boards.add({ ...board, name: name.trim() });
  homeScreen();
}

function forgetBoard(board) {
  if (!confirm(`Forget ${board.name}? You will need its public key to add it again.`)) return;
  boards.remove(board.targetPublicKey);
  homeScreen();
}

function exportBackup() {
  const backup = {
    format: "prns-hopspot-configure-backup/1",
    identity: localStorage.getItem(IDENTITY_KEY),
    boards: boards.list(),
  };
  download(new TextEncoder().encode(JSON.stringify(backup, null, 2)), "hopspot-owner-backup.json");
  toast("Backup downloaded. Keep it private: it controls your boards.");
}

function importBackup() {
  const input = h("input", { type: "file", accept: "application/json" });
  input.addEventListener("change", async () => {
    try {
      const backup = JSON.parse(await input.files[0].text());
      if (backup.format !== "prns-hopspot-configure-backup/1" || !backup.identity) throw new Error("Not a Hopspot Configure backup");
      fromBase64(backup.identity);
      if (!confirm("Replace this browser's owner key with the backup? The page will reload.")) return;
      localStorage.setItem(IDENTITY_KEY, backup.identity);
      boards.save(backup.boards ?? []);
      location.reload();
    } catch (error) {
      toast(error.message ?? String(error), "bad");
    }
  });
  input.click();
}

async function connectScreen(board) {
  const stage = h("p", { class: "muted" }, "Choose the board in the browser's USB prompt…");
  render(h("section", { class: "card" }, h("h2", {}, `Connecting to ${board.name}`), stage));
  try {
    await controller.connectUsb();
    session = await controller.open(board, (text) => (stage.textContent = text));
  } catch (error) {
    await controller.disconnectUsb();
    homeScreen();
    throw error;
  }
  await dashboard(board);
}

// ---------- dashboard ----------

async function dashboard(board) {
  const description = await session.call(rc.rcRequestDescribe());
  const can = new Set(description.requests ?? []);
  // The setup wizard's name becomes the board's announced name on the first connect.
  if (board.pendingName && can.has("SetNodeName")) {
    try {
      expectApplied(await session.call(rc.rcRequestSetNodeName(board.pendingName)), "Name");
      board = { ...board, pendingName: undefined };
      boards.add(board);
    } catch (error) {
      toast(error.message ?? String(error), "bad");
    }
  }
  const opening = { editing: new Set(), region: null };
  // The setup wizard's region becomes the LoRa profile on the first connect.
  if (board.pendingRegion && can.has("SetInterfaceLoRaProfile") && can.has("InventoryInterfaces")) {
    try {
      const lora = (await session.interfaces()).find((entry) => entry.interfaceKind === "LoRa");
      const auto = rc.rcRegionAutoProfile(board.pendingRegion);
      if (lora && !auto) {
        opening.editing.add(`lora:${lora.id}`);
        opening.region = board.pendingRegion;
        toast(`${board.pendingRegion} has no default radio settings: choose its frequency in the LoRa settings below`, "bad");
      } else if (lora && auto) {
        const text = `LoRa,${board.pendingRegion},${auto.frequencyHz},${auto.spreadingFactor},${auto.bandwidthKhz},${auto.codingRate},${auto.txPowerDbm},${auto.preamble}`;
        expectApplied(await session.call(rc.rcRequestSetInterfaceLoRaProfile(unhex(lora.id), text)), `Radio region ${board.pendingRegion}`);
      }
      board = { ...board, pendingRegion: undefined };
      boards.add(board);
    } catch (error) {
      toast(error.message ?? String(error), "bad");
    }
  }
  const view = { board, can, openPeers: new Set(), editing: opening.editing, suggestedRegion: opening.region };
  await drawDashboard(view);
  refreshTimer = setInterval(() => {
    if (view.editing.size === 0 && !document.hidden) void drawDashboard(view).catch(() => {});
  }, REFRESH_MS);
}

async function disconnect() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  session?.close();
  session = null;
  await controller.disconnectUsb();
  homeScreen();
}

async function drawDashboard(view) {
  const { board, can } = view;
  const [nodeName, build, power, interfaces] = await Promise.all([
    can.has("DescribeNodeName") ? session.call(rc.rcRequestDescribeNodeName()) : null,
    can.has("DescribeBuild") ? session.call(rc.rcRequestDescribeBuild()) : null,
    can.has("DescribePower") ? session.call(rc.rcRequestDescribePower()) : null,
    can.has("InventoryInterfaces") ? session.interfaces() : [],
  ]);
  const cards = [
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "row spread" },
        h("h2", {}, nodeName?.name ?? board.name),
        h(
          "div",
          { class: "row" },
          h("button", { onclick: () => disconnect().then(() => updateScreen(board)) }, "Update firmware"),
          h("button", { onclick: () => disconnect() }, "Disconnect"),
        ),
      ),
      can.has("SetNodeName") && nameEditor(view, nodeName?.name ?? board.name),
      h(
        "div",
        { class: "stats" },
        build && h("div", { class: "stat" }, h("span", {}, "Firmware"), h("strong", {}, build.version)),
        power &&
          h(
            "div",
            { class: "stat" },
            h("span", {}, "Battery"),
            h("strong", {}, power.battery === null ? "—" : `${power.battery}%`),
          ),
        power && h("div", { class: "stat" }, h("span", {}, "External power"), h("strong", {}, power.externalPower.replace(/\{.*\}/, "").trim())),
        h("div", { class: "stat" }, h("span", {}, "Interfaces"), h("strong", {}, String(interfaces.length))),
      ),
      systemControls(can),
    ),
  ];
  for (const entry of interfaces) cards.push(await interfaceCard(view, entry));
  const extras = deviceControls(can);
  if (extras) cards.push(extras);
  if (can.has("InventoryControllers")) cards.push(await controllersCard(view));
  if (session) render(...cards);
}

function nameEditor(view, current) {
  const input = h("input", { value: current, maxlength: "32", "aria-label": "Board name" });
  return editingDetails(
    view,
    "name",
    "Rename this board",
    h("p", { class: "muted small" }, "Other Reticulum apps and nodes show this name. Up to 32 characters."),
    h(
      "div",
      { class: "row" },
      input,
      h(
        "button",
        {
          class: "primary",
          onclick: (e) =>
            busy(e.currentTarget, async () => {
              const name = input.value.trim();
              expectApplied(await session.call(rc.rcRequestSetNodeName(name)), "Name");
              boards.add({ ...view.board, name });
              view.board = { ...view.board, name };
              view.editing.delete("name");
              await drawDashboard(view);
            }),
        },
        "Save name",
      ),
    ),
  );
}

function systemControls(can) {
  const buttons = [];
  if (can.has("AnnounceSelf"))
    buttons.push(
      h("button", { class: "primary", onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestAnnounceSelf()), "Announce")) }, "Announce now"),
    );
  if (can.has("SetSystemPower")) {
    buttons.push(
      h("button", { onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetSystemPower(true)), "Wake")) }, "Wake"),
      h(
        "button",
        {
          onclick: (e) => {
            if (!confirm("Put the board to sleep? All its radios stop until you wake it.")) return;
            void busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetSystemPower(false)), "Sleep"));
          },
        },
        "Sleep",
      ),
    );
  }
  if (can.has("SleepRadios"))
    buttons.push(h("button", { onclick: (e) => busy(e.currentTarget, async () => toast(`Radios: ${(await session.call(rc.rcRequestSleepRadios())).outcome}`)) }, "Sleep radios"));
  if (can.has("WakeRadios"))
    buttons.push(h("button", { onclick: (e) => busy(e.currentTarget, async () => toast(`Radios: ${(await session.call(rc.rcRequestWakeRadios())).outcome}`)) }, "Wake radios"));
  return buttons.length ? h("div", { class: "row" }, buttons) : null;
}

function deviceControls(can) {
  const rows = [];
  if (can.has("SetGnssPower"))
    rows.push(
      h(
        "div",
        { class: "row spread" },
        h("span", {}, "GPS"),
        h(
          "div",
          { class: "row" },
          h("button", { onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetGnssPower(true)), "GPS on")) }, "On"),
          h("button", { onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetGnssPower(false)), "GPS off")) }, "Off"),
        ),
      ),
    );
  if (can.has("SetDisplayVisibility"))
    rows.push(
      h(
        "div",
        { class: "row spread" },
        h("span", {}, "Screen"),
        h(
          "div",
          { class: "row" },
          h("button", { onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetDisplayVisibility(true)), "Screen on")) }, "On"),
          h("button", { onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetDisplayVisibility(false)), "Screen off")) }, "Off"),
        ),
      ),
    );
  if (can.has("SetDisplayAutoOff"))
    rows.push(
      h(
        "div",
        { class: "row spread" },
        h("span", {}, "Screen auto-off"),
        h(
          "div",
          { class: "row" },
          h("button", { onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetDisplayAutoOff(true)), "Auto-off")) }, "Enable"),
          h("button", { onclick: (e) => busy(e.currentTarget, async () => expectApplied(await session.call(rc.rcRequestSetDisplayAutoOff(false)), "Auto-off")) }, "Disable"),
        ),
      ),
    );
  if (rows.length === 0) return null;
  return h("section", { class: "card" }, h("h2", {}, "Device"), rows);
}

const KIND_LABELS = {
  LoRa: "LoRa radio",
  BluetoothAuto: "Bluetooth",
  UsbAutoDevice: "USB",
};

function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function connectionState(connection, enabled) {
  if (!enabled) return ["Off", "bad"];
  if (connection === "Connected") return ["Connected", "good"];
  if (connection === "Disabled") return ["Not configured", "warn"];
  return [connection.replace(/([a-z])([A-Z])/g, "$1 $2"), "warn"];
}

async function interfaceCard(view, entry) {
  const { can } = view;
  const config = can.has("InventoryInterfaceConfig") ? await session.call(rc.rcRequestInventoryInterfaceConfig(unhex(entry.id))) : null;
  const [stateText, stateKind] = connectionState(entry.connection, entry.enabled);
  const card = h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "row spread" },
      h("h2", {}, config?.name || kindLabel(entry.interfaceKind)),
      h("span", { class: "pill", dataset: { state: stateKind } }, stateText),
    ),
    h(
      "div",
      { class: "stats" },
      h("div", { class: "stat" }, h("span", {}, "Type"), h("strong", {}, kindLabel(entry.interfaceKind))),
      h("div", { class: "stat" }, h("span", {}, "Sent"), h("strong", {}, bytesText(entry.txBytes))),
      h("div", { class: "stat" }, h("span", {}, "Received"), h("strong", {}, bytesText(entry.rxBytes))),
      h("div", { class: "stat" }, h("span", {}, "Links"), h("strong", {}, String(entry.links))),
      config?.status === "Card" && h("div", { class: "stat" }, h("span", {}, "Known destinations"), h("strong", {}, String(config.destinations))),
      config?.group && h("div", { class: "stat" }, h("span", {}, "Group"), h("strong", {}, config.group)),
    ),
    config?.failure && h("p", { class: "small", style: "color: var(--bad)" }, config.failure),
  );
  const actions = h("div", { class: "row" });
  if (can.has("SetInterfacePower")) {
    actions.append(
      h(
        "button",
        {
          onclick: (e) => {
            const turningOff = entry.enabled;
            if (
              turningOff &&
              entry.interfaceKind === "UsbAutoDevice" &&
              !confirm("Turning USB off disconnects this page from the board. To get USB back, unplug the board and plug it in again (it restarts with everything on). Continue?")
            )
              return;
            void busy(e.currentTarget, async () => {
              expectApplied(await session.call(rc.rcRequestSetInterfacePower(unhex(entry.id), !turningOff)), `${kindLabel(entry.interfaceKind)} ${turningOff ? "off" : "on"}`);
              await drawDashboard(view);
            });
          },
        },
        `${entry.enabled ? "Turn off" : "Turn on"} ${kindLabel(entry.interfaceKind)}`,
      ),
      h("span", { class: "muted small" }, entry.enabled ? "Stays off until you turn it on or the board restarts." : "Turned off; the board turns it back on when it restarts."),
    );
  }
  if (actions.childElementCount) card.append(actions);

  const loraProfile = config?.config ? rc.rcParseLoRaConfig(config.config) : null;
  if (entry.interfaceKind === "LoRa" && can.has("SetInterfaceLoRaProfile")) card.append(loraEditor(view, entry, loraProfile));
  if (can.has("InventoryInterfaceDiscoveryGroups") && entry.interfaceKind === "BluetoothAuto") card.append(await groupsEditor(view, entry));
  if (can.has("SetInterfaceGroup") && entry.interfaceKind !== "UsbAutoDevice") card.append(groupEditor(view, entry, config));
  if (can.has("SetInterfaceMode")) card.append(modeEditor(view, entry));
  if (can.has("InventoryInterfacePeers")) card.append(await peersSection(view, entry));
  return card;
}

function editingDetails(view, key, summary, ...body) {
  const details = h("details", { open: view.editing.has(key) }, h("summary", {}, summary), ...body);
  details.addEventListener("toggle", () => {
    if (details.open) view.editing.add(key);
    else view.editing.delete(key);
  });
  return details;
}

function loraEditor(view, entry, current) {
  const regions = rc.rcLoRaRegions();
  const presets = rc.rcLoRaPresets();
  const wanted = view.suggestedRegion ?? current?.region;
  const region = h("select", {}, regions.map((label) => h("option", { value: label, selected: label === wanted }, label)));
  const preset = h(
    "select",
    {},
    presets.map((p) =>
      h("option", { value: p.label, selected: p.label === current?.preset }, `${p.label.replace(/([a-z])([A-Z])/g, "$1 $2")} (SF${p.spreadingFactor}, ${p.bandwidthKhz} kHz)`),
    ),
    h("option", { value: "custom", selected: current && !current.preset }, "Custom"),
  );
  const frequency = h("input", { type: "number", step: "0.001", value: current ? (current.frequencyHz / 1e6).toFixed(3) : "" });
  const power = h("input", { type: "number", min: "-9", max: "30", value: current?.txPowerDbm ?? 14 });
  const sf = h("select", {}, [5, 6, 7, 8, 9, 10, 11, 12].map((n) => h("option", { value: n, selected: n === (current?.spreadingFactor ?? 10) }, `SF${n}`)));
  const bw = h("select", {}, [125, 250, 500].map((n) => h("option", { value: n, selected: n === (current?.bandwidthKhz ?? 250) }, `${n} kHz`)));
  const cr = h("select", {}, [5, 6, 7, 8].map((n) => h("option", { value: n, selected: n === (current?.codingRate ?? 5) }, `4/${n}`)));
  const preamble = h("input", { type: "number", min: "6", max: "65535", value: current?.preamble ?? 18 });

  const syncPreset = () => {
    const chosen = presets.find((p) => p.label === preset.value);
    if (!chosen) return;
    sf.value = chosen.spreadingFactor;
    bw.value = chosen.bandwidthKhz;
    cr.value = chosen.codingRate;
  };
  preset.addEventListener("change", syncPreset);
  for (const field of [sf, bw, cr]) field.addEventListener("change", () => (preset.value = "custom"));
  region.addEventListener("change", () => {
    const auto = rc.rcRegionAutoProfile(region.value);
    if (!auto) return;
    frequency.value = (auto.frequencyHz / 1e6).toFixed(3);
    power.value = auto.txPowerDbm;
    sf.value = auto.spreadingFactor;
    bw.value = auto.bandwidthKhz;
    cr.value = auto.codingRate;
    preamble.value = auto.preamble;
    preset.value = auto.preset ?? "custom";
    toast(`Filled ${region.value}'s default LoRa settings`);
  });

  const summary = current
    ? `LoRa settings · ${current.region} · ${(current.frequencyHz / 1e6).toFixed(3)} MHz · ${current.preset ?? `SF${current.spreadingFactor}/${current.bandwidthKhz} kHz`} · ${current.txPowerDbm} dBm`
    : "LoRa settings · not configured yet";
  return editingDetails(
    view,
    `lora:${entry.id}`,
    summary,
    h("p", { class: "muted small" }, "Every radio you want to talk to must use the same region, frequency and preset."),
    h(
      "div",
      { class: "fields" },
      h("label", { class: "field" }, "Region", region),
      h("label", { class: "field" }, "Preset", preset),
      h("label", { class: "field" }, "Frequency (MHz)", frequency),
      h("label", { class: "field" }, "Transmit power (dBm)", power),
    ),
    h(
      "details",
      {},
      h("summary", {}, "Advanced"),
      h(
        "div",
        { class: "fields" },
        h("label", { class: "field" }, "Spreading factor", sf),
        h("label", { class: "field" }, "Bandwidth", bw),
        h("label", { class: "field" }, "Coding rate", cr),
        h("label", { class: "field" }, "Preamble symbols", preamble),
      ),
    ),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          class: "primary",
          onclick: (e) =>
            busy(e.currentTarget, async () => {
              const hz = Math.round(parseFloat(frequency.value) * 1e6);
              if (!Number.isFinite(hz) || hz <= 0) throw new Error("Enter a frequency in MHz");
              const text = `LoRa,${region.value},${hz},${sf.value},${bw.value},${cr.value},${parseInt(power.value, 10)},${parseInt(preamble.value, 10)}`;
              expectApplied(await session.call(rc.rcRequestSetInterfaceLoRaProfile(unhex(entry.id), text)), "LoRa settings");
              view.editing.delete(`lora:${entry.id}`);
              await drawDashboard(view);
            }),
        },
        "Save LoRa settings",
      ),
    ),
  );
}

async function groupsEditor(view, entry) {
  const result = await session.call(rc.rcRequestInventoryInterfaceDiscoveryGroups(unhex(entry.id)));
  if (result.status !== "Groups") return h("p", { class: "muted small" }, `Discovery groups: ${result.status}`);
  const groups = [...result.groups];
  const chips = h("div", { class: "chips" });
  const drawChips = () =>
    chips.replaceChildren(
      ...groups.map((group, index) =>
        h("span", { class: "chip" }, group, h("button", { "aria-label": `Remove ${group}`, onclick: () => { groups.splice(index, 1); drawChips(); } }, "×")),
      ),
    );
  drawChips();
  const input = h("input", { placeholder: "group name" });
  return editingDetails(
    view,
    `groups:${entry.id}`,
    `Bluetooth discovery groups · ${result.groups.join(", ") || "none"}`,
    h("p", { class: "muted small" }, "Boards only pair over Bluetooth with others that share a discovery group."),
    chips,
    h("div", { class: "row" }, input, h("button", { onclick: () => { if (input.value.trim()) { groups.push(input.value.trim()); input.value = ""; drawChips(); } } }, "Add")),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          class: "primary",
          onclick: (e) =>
            busy(e.currentTarget, async () => {
              expectApplied(await session.call(rc.rcRequestReplaceInterfaceDiscoveryGroups(unhex(entry.id), groups)), "Discovery groups");
              view.editing.delete(`groups:${entry.id}`);
              await drawDashboard(view);
            }),
        },
        "Save groups",
      ),
    ),
  );
}

function groupEditor(view, entry, config) {
  const input = h("input", { value: config?.group ?? "", placeholder: "group name" });
  return editingDetails(
    view,
    `group:${entry.id}`,
    `Interface group · ${config?.group || "default"}`,
    h("div", { class: "row" }, input, h(
      "button",
      {
        onclick: (e) =>
          busy(e.currentTarget, async () => {
            expectApplied(await session.call(rc.rcRequestSetInterfaceGroup(unhex(entry.id), input.value.trim())), "Group");
            view.editing.delete(`group:${entry.id}`);
            await drawDashboard(view);
          }),
      },
      "Save",
    )),
  );
}

function modeEditor(view, entry) {
  const select = h("select", {}, rc.rcInterfaceModes().map((mode) => h("option", { value: mode, selected: mode === entry.mode }, mode)));
  return editingDetails(
    view,
    `mode:${entry.id}`,
    `Interface mode · ${entry.mode}`,
    h("div", { class: "row" }, select, h(
      "button",
      {
        onclick: (e) =>
          busy(e.currentTarget, async () => {
            expectApplied(await session.call(rc.rcRequestSetInterfaceMode(unhex(entry.id), select.value)), "Mode");
            view.editing.delete(`mode:${entry.id}`);
            await drawDashboard(view);
          }),
      },
      "Save",
    )),
  );
}

async function peersSection(view, entry) {
  const key = `peers:${entry.id}`;
  const open = view.openPeers.has(key);
  const details = h("details", { open }, h("summary", {}, "Peers"));
  details.addEventListener("toggle", async () => {
    if (details.open) {
      view.openPeers.add(key);
      details.append(await peersTable(entry));
    } else {
      view.openPeers.delete(key);
      details.replaceChildren(details.firstChild);
    }
  });
  if (open) details.append(await peersTable(entry));
  return details;
}

async function peersTable(entry) {
  const peers = await session.peers(entry.id);
  if (peers.length === 0) return h("p", { class: "muted small" }, "No peers right now.");
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, h("th", {}, "Peer"), h("th", {}, "State"), h("th", {}, "Sent"), h("th", {}, "Received"), h("th", {}, "Signal"))),
      h(
        "tbody",
        {},
        peers.map((peer) =>
          h(
            "tr",
            {},
            h("td", { class: "mono" }, peer.id),
            h("td", {}, peer.connection),
            h("td", {}, bytesText(peer.txBytes)),
            h("td", {}, bytesText(peer.rxBytes)),
            h("td", { class: "small" }, peer.radio),
          ),
        ),
      ),
    ),
  );
}

async function controllersCard(view) {
  const { can } = view;
  const list = await session.controllers();
  const me = hex(controller.hash);
  const key = h("input", { placeholder: "their public key (128 hex digits)", class: "mono" });
  return h(
    "section",
    { class: "card" },
    h("h2", {}, "Who can control this board"),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h(
          "tbody",
          {},
          list.map((hash) =>
            h(
              "tr",
              {},
              h("td", { class: "mono" }, hash),
              h("td", {}, hash === me ? h("span", { class: "pill", dataset: { state: "good" } }, "This browser") : ""),
              h(
                "td",
                {},
                can.has("RevokeController") && hash !== me
                  ? h(
                      "button",
                      {
                        class: "danger",
                        onclick: (e) => {
                          if (!confirm("Remove this controller's access?")) return;
                          void busy(e.currentTarget, async () => {
                            expectApplied(await session.call(rc.rcRequestRevokeController(unhex(hash))), "Access removed");
                            await drawDashboard(view);
                          });
                        },
                      },
                      "Remove",
                    )
                  : "",
              ),
            ),
          ),
        ),
      ),
    ),
    can.has("AuthorizeController") &&
      editingDetails(
        view,
        "authorize",
        "Give another browser or app access",
        h("p", { class: "muted small" }, "On the other device, open this page and copy its public key from “This browser's owner key”."),
        h("div", { class: "row" }, key, h(
          "button",
          {
            class: "primary",
            onclick: (e) =>
              busy(e.currentTarget, async () => {
                expectApplied(await session.call(rc.rcRequestAuthorizeController(unhex(key.value))), "Access granted");
                view.editing.delete("authorize");
                await drawDashboard(view);
              }),
          },
          "Grant access",
        )),
      ),
  );
}

// ---------- start ----------

async function drain(stream) {
  try {
    for await (const _ of stream) {
      // The page reads state on demand; events only need consuming so the runtime never backs up.
    }
  } catch {
    // The stream ends when the runtime stops.
  }
}

async function start() {
  if (!("usb" in navigator)) {
    runtimeBadge.textContent = "Unsupported browser";
    runtimeBadge.dataset.state = "bad";
    render(h("section", { class: "card" }, h("h2", {}, "This browser can't talk to USB devices"), h("p", {}, "Open this page in Chrome or Edge on a computer.")));
    return;
  }
  const wasmUrl = new URL("./pkg/prns_wasm.js", location.href);
  await initWasm({ module_or_path: new URL("./pkg/prns_wasm_bg.wasm", location.href) });
  const created = await Prns.create({
    wasmModuleUrl: wasmUrl,
    resourceCompressionModuleUrl: wasmUrl,
    identityStore: new BrowserLocalStorageIdentityStore(IDENTITY_KEY),
  });
  if (created.tag !== "Ready") throw new Error(`Runtime: ${describe(created)}`);
  const prns = created.data;
  const events = prns.claimEvents();
  if (events.tag !== "AlreadyClaimed") void drain(events.data);
  const diagnostics = prns.claimDiagnostics();
  if (diagnostics.tag !== "AlreadyClaimed") void drain(diagnostics.data);
  const stored = localStorage.getItem(IDENTITY_KEY);
  if (!stored) throw new Error("The owner key was not stored");
  const secret = fromBase64(stored);
  controller = new Controller(prns, secret);
  secret.fill(0);
  runtimeBadge.textContent = "Ready";
  runtimeBadge.dataset.state = "good";
  navigator.usb.addEventListener("disconnect", () => {
    if (session) {
      toast("The board was unplugged", "bad");
      void disconnect();
    }
  });
  homeScreen();
}

start().catch((error) => {
  runtimeBadge.textContent = "Error";
  runtimeBadge.dataset.state = "bad";
  render(h("section", { class: "card" }, h("h2", {}, "Something went wrong"), h("p", { class: "mono" }, error.message ?? String(error))));
});
