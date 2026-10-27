# LED Badge Protocol

Reference for the "wang" protocol used by 44x11 monochrome LED name badges built on the WCH CH582/CH583 microcontroller. The same byte stream is accepted over both USB HID and Bluetooth LE.

- [Hardware](#hardware)
- [Transports](#transports): [USB HID](#usb-hid), [Bluetooth LE](#bluetooth-le)
- [Wire Format](#wire-format): [Header](#header), [Modes](#modes), [Speed](#speed), [Bitmap Payload](#bitmap-payload)
- [Animation](#animation)
- [Firmware Detection](#firmware-detection)
- [Capacity](#capacity)
- [Verification](#verification)

## Hardware

| Parameter | Specification |
|---|---|
| MCU | WCH CH582 (RISC-V, integrated BLE) |
| Display | 44 x 11 monochrome LED matrix |
| Device Buffer | 8192 bytes |
| Message Slots | 8 |
| USB VID:PID | `0x0416:0x5020` (`wch.cn` / `CH583`) |
| PCB Revisions | Silkscreen `250901`, `260404` |

LEDs are mounted diagonally; physical pixels appear approximately square on the 44x11 grid.

## Transports

Both transports accept the identical byte stream defined in [Wire Format](#wire-format). Framing differs: 64-byte HID reports for USB, 16-byte GATT writes for Bluetooth LE.

USB HID transfers complete without manual button presses and do not time out during transfers.

### USB HID

The stock firmware implements a vendor-defined HID interface:

| Property | Value |
|---|---|
| Vendor ID | `0x0416` (`wch.cn`) |
| Product ID | `0x5020` (`CH583`) |
| Device Class | 0 |
| Interface | 0 |
| Interface Class | 3 (HID) |
| Interface Subclass | 0 |
| Protocol | 0 |
| Endpoints | 2 |
| Report Size | 64 bytes (input and output, no report ID) |

Report descriptor:

```
06 00 FF     Usage Page (vendor-defined 0xFF00)
09 01        Usage (1)
A1 01        Collection (Application)
09 02          Usage (2)
15 00          Logical Minimum (0)
26 00 FF       Logical Maximum (255)
75 08          Report Size (8)
95 40          Report Count (64)
81 06          Input  (Data, Var, Rel)
09 02          Usage (2)
15 00 26 00 FF 75 08 95 40
91 06          Output (Data, Var, Rel)
C0           End Collection
```

Payloads must be zero-padded to a multiple of 64 bytes. Each report contains exactly 64 bytes. For host APIs requiring a report ID byte prefix, prepend `0x00`.

To inspect USB descriptors on host systems:
- macOS:
  ```bash
  ioreg -w0 -l -r -n CH583 | grep -E "bInterfaceClass|ReportDescriptor"
  ```
- Linux:
  ```bash
  lsusb -v -d 0416:5020
  ```

On Linux, non-root access requires udev permissions. See [`99-led-badge.rules`](99-led-badge.rules).

### Bluetooth LE

| Parameter | Value |
|---|---|
| Advertised Name | `LSLED` |
| Service UUID | `0000fee0-0000-1000-8000-00805f9b34fb` |
| Characteristic UUID | `0000fee1-0000-1000-8000-00805f9b34fb` |
| Write Size | 16 bytes (write-with-response) |

All BLE writes must be exactly 16 bytes. Writes exceeding 16 bytes are unacknowledged and cause the connection to hang.

The badge commits uploaded data to flash upon link disconnection. Disconnect the BLE link after the final write.

#### Entering Bluetooth Mode

The badge does not advertise Bluetooth while connected to USB:
1. Disconnect the USB cable.
2. Press button 1. The Bluetooth icon appears on the LED display.

The badge exits Bluetooth mode after each completed upload. Repeat step 2 before each transfer.

#### Transfer Timing and Limits

Bluetooth mode times out after approximately 2 minutes. Mid-transfer timeouts result in partial buffer writes.

Write count formula:
```
writes = ceil((64 + columns * 11) / 16)
```

At approximately 250 ms per write:
- 1 short message (11 writes): ~2.8 s.
- 64 frames (268 writes): ~67 s.

Failed BLE uploads cannot be resumed. Incomplete transfers require retransmitting from byte 0.

## Wire Format

A 64-byte header followed by the column-major bitmap payload. Up to 8 message slots share one upload.

### Header

| Offset | Size (Bytes) | Field | Description |
|---|---|---|---|
| 0 | 4 | Magic | Literal ASCII `"wang"` (`0x77 0x61 0x6E 0x67`) |
| 4 | 1 | Reserved | `0x00` |
| 5 | 1 | Brightness | Bits 7:4: `0x00`=100%, `0x10`=75%, `0x20`=50%, `0x30`=25% |
| 6 | 1 | Blink | Bitmask, bit i enables blink for message slot i |
| 7 | 1 | Border | Bitmask, bit i enables animated border for message slot i |
| 8 | 8 | Options | 1 byte per slot: `((speed - 1) << 4) | mode` |
| 16 | 16 | Length | Big-endian `u16` per slot: length in byte columns |
| 32 | 6 | Reserved | All zeros |
| 38 | 6 | Timestamp | `year % 100`, `month`, `day`, `hour`, `minute`, `second` (decimal) |
| 44 | 20 | Reserved | All zeros |
| 64 | - | Payload | Column-major bitmap payload |

Unused message slots set length to 0.

#### Brightness Encoding

Byte 5 defines panel brightness in bits 7:4. Valid index values:
- `0x00`: 100%
- `0x10`: 75%
- `0x20`: 50%
- `0x30`: 25%

The CH582 firmware indexes a 4-element lookup table using bits 7:4. Values of `0x40` and higher exceed table bounds and cause display corruption.

### Display Modes

Bits 3:0 of each per-message option byte:

| Value | Mode | Behavior |
|---|---|---|
| 0 | Scroll Left | Scrolls right to left |
| 1 | Scroll Right | Scrolls left to right |
| 2 | Scroll Up | Scrolls upward into view, pauses 15 steps, scrolls upward out of view |
| 3 | Scroll Down | Scrolls downward into view, pauses 15 steps, scrolls downward out of view |
| 4 | Fixed | Centered, static |
| 5 | Animation | Displays sequence frame by frame |
| 6 | Snowflake | Pixels fall from top in staggered rows, pause, fall downward out of view |
| 7 | Picture | Two lit columns sweep outward from center to reveal image, then invert |
| 8 | Laser | Column sweeps left to right with horizontal beams, clears in reverse |

### Speed Settings

Bits 7:4 of each per-message option byte store `speed - 1` (values 0 to 7 representing speeds 1 to 8).

Hardware measurement: an 8-frame animation at speed 6 completes 5 loops in 10.0 seconds (250 ms per frame).

| Speed | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Frame Duration (ms) | 552 | 491 | 431 | 371 | 310 | 250 | 190 | 129 |

Speed 6 is verified by hardware timing. Speeds 1 through 5 and 7 through 8 are linear estimates. Scroll step intervals are unverified.

### Bitmap Payload

Bitmap data is packed in column-major order. Each column block is 8 pixels wide and 11 pixels high, encoded as 11 bytes (1 byte per row, top to bottom). The most significant bit (MSB) represents the leftmost pixel:

```
byte_index = column_block * 11 + row
bit_(7 - n) = pixel at x = (column_block * 8) + n
```

Length fields in the header specify **byte columns** (`ceil(width_px / 8)`), not pixel counts. Standard text glyphs are 8 px wide (1 byte column).

## Animation

Mode 5 treats a slot payload as a horizontal sequence of frames. Each frame is 11 px high. Frame advance width depends on firmware:

| Firmware | Frame Width |
|---|---|
| Stock | 48 px |
| badgemagic | 44 px |

Total image width equals `frame_count * frame_width`.

On badgemagic firmware (44 px width), frames are not byte-aligned (5.5 byte columns). An odd number of frames rounds up to the next whole byte column. On stock firmware (48 px width), frames align to 6 byte columns.

Each slot holds up to 8 animation frames. The badge cycles sequentially across all 8 slots (64 frames maximum per upload).

## Firmware Detection

Stock firmware and [badgemagic](https://github.com/fossasia/badgemagic-firmware) firmware use the same wire protocol, but differ in frame advance width and Bluetooth pairing requirements.

To identify the active firmware:

| Transport | Query | badgemagic Response | Stock Firmware Response |
|---|---|---|---|
| USB | USB descriptor strings | Manufacturer: `FOSSASIA WAS HERE`<br>Product: `LED Badge Magic`<br>Serial: `BM1144 fw: v*` | Manufacturer: `wch.cn`<br>Product: `CH583` |
| Bluetooth | Device Information Service (`0x180A`) | Manufacturer (`0x2A29`): `FOSSASIA`<br>Model (`0x2A24`): `BM1144` | Service `0x180A` not present |

Both firmwares use identical USB VID:PID (`0x0416:0x5020`). Do not filter by advertised Bluetooth name (`LSLED`), which is user-configurable in `badge_cfg.ble_devname`.

### badgemagic Bluetooth PIN

badgemagic firmware supports an optional 4-digit Bluetooth PIN. If enabled, the badge rejects the initial `wang` packet with `ATT_ERR_UNLIKELY` (`0x0E`).

The PIN is transmitted as 4 ASCII digits in bytes 0 to 3 of a 16-byte zero-padded packet preceding the `wang` header. Authorization resets on disconnection. Stock firmware does not support PIN authorization.

## Capacity

Maximum theoretical payload from the 8192-byte device buffer:
```
payload_max = 8192 - 64        = 8128 bytes
columns_max = floor(8128 / 11) = 738 byte columns
```

Verified transfer limits:

| Payload | Columns | Bytes | 16-Byte Writes | Result |
|---|---|---|---|---|
| Text (9 glyphs) | 9 | 163 | 11 | Complete |
| 1 slot, 8 frames | 48 | 592 | 37 | Complete |
| 1 slot, 24 frames | 144 | 1648 | 103 | BLE timeout at write 60 |
| 1 slot, 60 frames | 360 | 4024 | 252 | BLE timeout |
| 8 slots, 8 frames each | 384 | 4288 | 268 | Complete (all 64 frames verified) |

BLE stalls are caused by connection timeouts (approximately 2 minutes). Over USB HID, 4288-byte transfers complete in 67 reports (< 1 s).

## Verification

The device protocol provides no application-layer acknowledgments, checksums, or read-back mechanisms. Transport delivery indicates bytes were received by the controller; display output confirms payload rendering.
