// Copyright 2026 Martin Bogomolni
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * The browser host.
 *
 * Everything the desktop gets from Rust, obtained from a web API instead:
 * WebHID and Web Bluetooth for the badge, the File System Access API for
 * documents, IndexedDB for the autosave. The editor above this line is the
 * same code in both builds.
 */

import type { BadgeInfo, TextBitmap } from "../types";
import { withTimeout, operationLock, OperationTimeout } from "./async";
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES } from "../limits";
import { encode } from "./wire";
import { fontMetrics as metrics, layout } from "./webfont";
import type {
  DocRef,
  FaceInfo,
  Firmware,
  MessageSpec,
  Platform,
  Progress,
  Recovery,
  UsbInfo,
} from "./types";

// --- badge identity ---------------------------------------------------------

const USB_VID = 0x0416;
const USB_PID = 0x5020;
const HID_REPORT = 64;

const BLE_SERVICE = 0xfee0;
const BLE_CHAR = 0xfee1;
const BLE_CHUNK = 16;
/** Device Information, and the two characteristics worth reading from it. */
const BLE_DIS = 0x180a;
const DIS_MODEL = 0x2a24;
const DIS_MANUFACTURER = 0x2a29;

const VENDOR = "FOSSASIA";
const MARKS = ["BADGE MAGIC", "BM1144"];

/** Mirrors `firmware::identify`: any one field is enough. */
function identify(fields: (string | null | undefined)[]): Firmware {
  for (const f of fields) {
    if (!f) continue;
    const up = f.toUpperCase();
    if (up.startsWith(VENDOR) || MARKS.some((m) => up.includes(m)))
      return "badge-magic";
  }
  return "stock";
}

// --- USB (WebHID) -----------------------------------------------------------

const deviceOperation = operationLock();

const hid = () => (navigator as Navigator & { hid?: HID }).hid;

let usbDevice: HIDDevice | null = null;

function toUsbInfo(d: HIDDevice): UsbInfo {
  return {
    manufacturer: null, // WebHID exposes no manufacturer string.
    product: d.productName || null,
    serial: null,
    firmware: identify([d.productName]),
  };
}

const isBadge = (d: HIDDevice) =>
  d.vendorId === USB_VID && d.productId === USB_PID;

async function findGrantedUsb(): Promise<HIDDevice | null> {
  const h = hid();
  if (!h) return null;
  const d = (await h.getDevices()).find(isBadge) ?? null;
  if (d && !d.opened)
    await withTimeout(d.open(), 5000, "USB connection timed out.");
  usbDevice = d;
  return d;
}

/**
 * Ask for a badge over USB.
 *
 * Unlike the desktop, the browser cannot see a device until the user has
 * picked it from Chrome's own chooser, and that chooser only opens from a user
 * gesture. So this is a deliberate action in the UI rather than something that
 * happens when the cable goes in.
 */
export async function requestUsb(): Promise<UsbInfo | null> {
  const h = hid();
  if (!h)
    throw new Error(
      "This browser has no WebHID. Use Chrome, Edge or Opera on desktop.",
    );
  const [d] = await h.requestDevice({
    filters: [{ vendorId: USB_VID, productId: USB_PID }],
  });
  if (!d) return null;
  if (!d.opened) await withTimeout(d.open(), 5000, "USB connection timed out.");
  usbDevice = d;
  return toUsbInfo(d);
}

// --- Bluetooth (Web Bluetooth) ----------------------------------------------

const ble = () =>
  (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;

interface BleLink {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
}
let bleLink: BleLink | null = null;

async function readDis(server: BluetoothRemoteGATTServer): Promise<Firmware> {
  // Optional: plenty of badges answer without it, and a missing service must
  // not fail the upload.
  try {
    const svc = await server.getPrimaryService(BLE_DIS);
    const dec = new TextDecoder();
    const read = async (uuid: number) => {
      try {
        return dec.decode(
          await (await svc.getCharacteristic(uuid)).readValue(),
        );
      } catch {
        return null;
      }
    };
    return identify([await read(DIS_MANUFACTURER), await read(DIS_MODEL)]);
  } catch {
    return "stock";
  }
}

async function connectBle(): Promise<BleLink> {
  const b = ble();
  if (!b)
    throw new Error(
      "This browser has no Web Bluetooth. Use Chrome, Edge or Opera.",
    );
  const device = await b.requestDevice({
    filters: [{ services: [BLE_SERVICE] }],
    optionalServices: [BLE_DIS],
  });
  if (!device.gatt)
    throw new Error("This device has no Bluetooth GATT service.");
  let expired = false;
  const disconnect = () => {
    expired = true;
    device.gatt?.disconnect();
  };
  try {
    const server = await withTimeout(
      device.gatt.connect().then((server) => {
        if (expired) {
          server.disconnect();
          throw new Error("Connection was cancelled.");
        }
        return server;
      }),
      20000,
      "Bluetooth connection timed out.",
      disconnect,
    );
    const svc = await withTimeout(
      server.getPrimaryService(BLE_SERVICE),
      5000,
      "Bluetooth service discovery timed out.",
      disconnect,
    );
    const characteristic = await withTimeout(
      svc.getCharacteristic(BLE_CHAR),
      5000,
      "Bluetooth characteristic discovery timed out.",
      disconnect,
    );
    const link = { device, characteristic };
    bleLink = link;
    device.addEventListener(
      "gattserverdisconnected",
      () => {
        if (bleLink === link) bleLink = null;
      },
      { once: true },
    );
    return link;
  } catch (e) {
    disconnect();
    throw e;
  }
}

// --- documents --------------------------------------------------------------

/**
 * Handles the editor refers to by an opaque token.
 *
 * The File System Access API will not hand back a path, so "where is this
 * file" is a name we chose. The editor only displays it and passes it back.
 */
const handles = new Map<DocRef, FileSystemFileHandle>();
let handleSeq = 0;

const keep = (h: FileSystemFileHandle): DocRef => {
  const ref = `${h.name}\u0000${++handleSeq}`;
  handles.set(ref, h);
  return ref;
};

/** The visible half of a DocRef. */
export const refName = (ref: DocRef) => ref.split("\u0000")[0];

const PICKER = {
  project: { desc: "BlinkenBadge project", ext: ".badge" },
  message: { desc: "BlinkenBadge message", ext: ".badgemsg" },
} as const;

const supportsFsa = () => "showOpenFilePicker" in globalThis;

/**
 * Fallback for a browser without the File System Access API.
 *
 * Firefox and Safari have neither this nor WebHID, so in practice this is only
 * reached if a Chromium build disables the picker. Save becomes a download,
 * which loses Save In Place.
 */
function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function inputFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement("input");
    el.type = "file";
    el.accept = accept;
    el.onchange = () => resolve(el.files?.[0] ?? null);
    el.oncancel = () => resolve(null);
    el.click();
  });
}

// --- autosave and recents (IndexedDB) ---------------------------------------

const DB = "blinkenbadge";
const STORE = "session";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await idb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(tx.error ?? new Error("Storage transaction failed."));
    });
  } finally {
    db.close();
  }
}

async function get<T>(key: string): Promise<T | null> {
  const db = await idb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      tx.oncomplete = () => resolve((req.result as T) ?? null);
      tx.onerror = tx.onabort = () =>
        reject(tx.error ?? new Error("Storage transaction failed."));
    });
  } finally {
    db.close();
  }
}

async function readDocument(file: File) {
  if (file.size > MAX_DOCUMENT_BYTES)
    throw new Error("Document exceeds the 8 MiB limit.");
  return file.text();
}

// --- events -----------------------------------------------------------------

/**
 * There is no native menu, so the in-page one raises the same ids on the
 * window and the editor never learns the difference.
 */
export const MENU_EVENT = "badge-menu";

function domSub<T>(name: string, cb: (detail: T) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<T>).detail);
  window.addEventListener(name, h);
  return () => window.removeEventListener(name, h);
}

const usbListeners = new Set<(i: UsbInfo | null) => void>();
const progressListeners = new Set<(p: Progress) => void>();
const emitProgress = (chunk: number, total: number) => {
  for (const f of progressListeners) f({ chunk, total });
};

if (typeof navigator !== "undefined" && hid()) {
  // Chrome fires these for devices the user has already granted, so unplugging
  // and reconnecting behaves like the desktop's watcher.
  hid()!.addEventListener("connect", (e) => {
    const d = (e as HIDConnectionEvent).device;
    if (!isBadge(d)) return;
    void withTimeout(d.open(), 5000, "USB connection timed out.")
      .then(() => {
        usbDevice = d;
        for (const f of usbListeners) f(toUsbInfo(d));
      })
      .catch(() => {});
  });
  hid()!.addEventListener("disconnect", (e) => {
    if (!isBadge((e as HIDConnectionEvent).device)) return;
    usbDevice = null;
    for (const f of usbListeners) f(null);
  });
}

/** Raise a menu action from the in-page menu. */
export const fireMenu = (id: string) => {
  window.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: id }));
};

// --- the platform -----------------------------------------------------------

export const platform: Platform = {
  kind: "web",

  openExternal: async (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  fontMetrics: async (): Promise<FaceInfo[]> => metrics(),
  renderText: async (text, face): Promise<TextBitmap> => layout(text, face),

  requestUsb,

  usbFind: async () => {
    const d = await findGrantedUsb();
    return d ? toUsbInfo(d) : null;
  },
  onUsbPresence: (cb) => {
    usbListeners.add(cb);
    return () => {
      usbListeners.delete(cb);
    };
  },
  onSendProgress: (cb) => {
    progressListeners.add(cb);
    return () => {
      progressListeners.delete(cb);
    };
  },

  /**
   * Web Bluetooth has no passive scan: the browser shows its own chooser and
   * hands back exactly the one device the user picked. So this returns a list
   * of one rather than a survey.
   */
  bleScan: () =>
    deviceOperation(async (): Promise<BadgeInfo[]> => {
      bleLink?.device.gatt?.disconnect();
      bleLink = null;
      const l = await connectBle();
      return [
        {
          id: l.device.id,
          name: l.device.name ?? null,
          rssi: null,
          services: [],
        },
      ];
    }),

  sendUsb: (messages: MessageSpec[], brightness) =>
    deviceOperation(async () => {
      const d = usbDevice ?? (await findGrantedUsb());
      if (!d)
        throw new Error("No badge connected over USB. Press Connect first.");
      const data = encode(messages, brightness, identify([d.productName]));
      // Report Count is fixed at 64, so a short final report is malformed rather
      // than partial. The leading 0 is the report-ID argument; this device has no
      // report IDs and never sees the byte.
      const padded = new Uint8Array(
        Math.ceil(data.length / HID_REPORT) * HID_REPORT,
      );
      padded.set(data);
      const total = padded.length / HID_REPORT;
      for (let i = 0, n = 0; i < padded.length; i += HID_REPORT, n++) {
        await withTimeout(
          d.sendReport(0, padded.subarray(i, i + HID_REPORT)),
          8000,
          "USB transfer timed out.",
          () => {
            usbDevice = null;
            void d.close().catch(() => {});
          },
        );
        emitProgress(n + 1, total);
      }
      return data.length;
    }),

  sendBle: (messages: MessageSpec[], brightness) =>
    deviceOperation(async () => {
      const link = bleLink ?? (await connectBle());
      const disconnect = () => {
        link.device.gatt?.disconnect();
        if (bleLink === link) bleLink = null;
      };
      try {
        const fw = link.device.gatt
          ? await withTimeout(
              readDis(link.device.gatt),
              5000,
              "Firmware detection timed out.",
              disconnect,
            )
          : "stock";
        const data = encode(messages, brightness, fw);
        const total = Math.ceil(data.length / BLE_CHUNK);
        for (let i = 0, n = 0; i < data.length; i += BLE_CHUNK, n++) {
          const chunk = new Uint8Array(
            data.subarray(i, Math.min(i + BLE_CHUNK, data.length)),
          );
          let error: unknown = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await withTimeout(
                link.characteristic.writeValueWithResponse(chunk),
                8000,
                "Bluetooth transfer timed out; press button 1 and retry.",
                disconnect,
              );
              error = null;
              break;
            } catch (e) {
              if (e instanceof OperationTimeout) throw e;
              error = e;
              if (!link.device.gatt?.connected) break;
              if (attempt < 2)
                await new Promise((resolve) => setTimeout(resolve, 60));
            }
          }
          if (error)
            throw new Error(
              `Bluetooth stopped after ${n} of ${total} writes; press button 1 and retry.`,
            );
          emitProgress(n + 1, total);
        }
        return data.length;
      } finally {
        disconnect();
      }
    }),

  pickOpen: async (kind) => {
    const { desc, ext } = PICKER[kind];
    if (!supportsFsa()) {
      const f = await inputFile(ext);
      return f ? { path: f.name, text: await readDocument(f) } : null;
    }
    try {
      const [h] = await showOpenFilePicker({
        types: [{ description: desc, accept: { "application/json": [ext] } }],
        multiple: false,
      });
      return { path: keep(h), text: await readDocument(await h.getFile()) };
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  },

  pickSave: async (kind, suggested) => {
    const { desc, ext } = PICKER[kind];
    // No handle to save back to, so this becomes a download at write time.
    if (!supportsFsa()) return suggested;
    try {
      const h = await showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: desc, accept: { "application/json": [ext] } }],
      });
      return keep(h);
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  },

  readText: async (ref) => {
    const h = handles.get(ref);
    if (!h) throw new Error(`${refName(ref)} is no longer open.`);
    return readDocument(await h.getFile());
  },

  writeText: async (ref, contents) => {
    const h = handles.get(ref);
    if (!h) {
      downloadText(refName(ref), contents);
      return;
    }
    const w = await h.createWritable();
    await w.write(contents);
    await w.close();
  },

  pickImage: async () => {
    const f = await inputFile(
      "image/png,image/gif,image/bmp,image/jpeg,image/webp",
    );
    if (!f) return null;
    if (f.size > MAX_IMAGE_BYTES)
      throw new Error("Image exceeds the 16 MiB limit.");
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
  },

  // Only an installed PWA is handed files to open, and only on some platforms.
  takePendingFiles: async () => [],

  recentClear: () => put("recent", []),
  recoveryRead: () => get<Recovery>("recovery"),
  recoveryWrite: (json, path, savedAt) =>
    put("recovery", { json, path, saved_at: savedAt }),
  recoveryClear: () => put("recovery", null),

  setTitle: (title) => {
    document.title = title;
  },
  confirmExit: async () => {
    // Nothing to hold: the browser is already unloading, or the user simply
    // stays on the page.
  },
  onMenu: (cb) => domSub<string>(MENU_EVENT, cb),
  fireMenu: (id) => fireMenu(id),
  onOpenFile: () => () => {},
  onExitRequested: (cb) => {
    const h = (e: BeforeUnloadEvent) => {
      if (cb()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  },
};
