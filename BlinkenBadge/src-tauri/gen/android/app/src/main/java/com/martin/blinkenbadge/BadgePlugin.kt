package com.martin.blinkenbadge

import android.Manifest
import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.UUID

@InvokeArg class ScanArgs { var timeoutMs: Long = 6000 }
@InvokeArg class BadgeSendArgs { lateinit var deviceId: String; lateinit var stock: String; lateinit var magic: String }

@TauriPlugin(permissions = [
  Permission(alias = "nearby", strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT]),
  Permission(alias = "location", strings = [Manifest.permission.ACCESS_FINE_LOCATION])
])
class BadgePlugin(private val host: Activity): Plugin(host) {
  private val main = Handler(Looper.getMainLooper())
  private val service = UUID.fromString("0000fee0-0000-1000-8000-00805f9b34fb")
  private val writeId = UUID.fromString("0000fee1-0000-1000-8000-00805f9b34fb")
  private val infoId = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
  private val devices = mutableMapOf<String, BluetoothDevice>()
  private var activeScan: ScanCallback? = null
  private var activeScanInvoke: Invoke? = null
  private var gatt: BluetoothGatt? = null
  private var sendInvoke: Invoke? = null
  private var timeout: Runnable? = null
  private var totalTimeout: Runnable? = null
  private var payload = byteArrayOf()
  private var stock = byteArrayOf()
  private var magic = byteArrayOf()
  private var offset = 0
  private var metadata = ""
  private var output: BluetoothGattCharacteristic? = null
  private var infoQueue = ArrayDeque<BluetoothGattCharacteristic>()

  private fun alias() = if (Build.VERSION.SDK_INT >= 31) "nearby" else "location"
  private fun permitted(invoke: Invoke, callback: String): Boolean {
    if (getPermissionState(alias()) == PermissionState.GRANTED) return true
    requestPermissionForAlias(alias(), invoke, callback)
    return false
  }
  private fun adapter(): BluetoothAdapter {
    val adapter = (host.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
      ?: throw IllegalStateException("This device has no Bluetooth adapter.")
    if (!adapter.isEnabled) throw IllegalStateException("Turn on Bluetooth, then try again.")
    return adapter
  }
  @Command fun scan(invoke: Invoke) { if (permitted(invoke, "scanGranted")) beginScan(invoke) }
  @PermissionCallback fun scanGranted(invoke: Invoke) {
    if (getPermissionState(alias()) == PermissionState.GRANTED) beginScan(invoke)
    else invoke.reject("Bluetooth permission was denied; enable it in app settings.")
  }
  private fun beginScan(invoke: Invoke) { main.post {
    try {
      if (activeScanInvoke != null || sendInvoke != null) { invoke.reject("A device operation is already running."); return@post }
      val scanner = adapter().bluetoothLeScanner ?: throw IllegalStateException("Bluetooth scanning is unavailable.")
      val args = invoke.parseArgs(ScanArgs::class.java)
      val found = mutableMapOf<String, JSObject>()
      devices.clear()
      val callback = object: ScanCallback() {
        override fun onScanResult(type: Int, result: ScanResult) { main.post {
          if (activeScanInvoke !== invoke) return@post
          val id = result.device.address
          devices[id] = result.device
          val item = JSObject()
          item.put("id", id); item.put("name", result.scanRecord?.deviceName ?: result.device.name)
          item.put("rssi", result.rssi); item.put("services", JSArray().put(service.toString()))
          found[id] = item
        } }
        override fun onScanFailed(code: Int) { main.post {
          if (activeScanInvoke === invoke) {
            try { scanner.stopScan(this) } catch (_: Exception) {}
            activeScanInvoke = null; activeScan = null
            invoke.reject("Bluetooth scan failed ($code); wait a moment and try again.")
          }
        } }
      }
      activeScan = callback; activeScanInvoke = invoke
      scanner.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(service)).build()),
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
      main.postDelayed({
        if (activeScanInvoke === invoke) {
          try { scanner.stopScan(callback) } catch (_: Exception) {}
          activeScanInvoke = null; activeScan = null
          val response = JSObject(); val list = JSArray()
          found.values.sortedByDescending { it.optInt("rssi", -200) }.forEach { list.put(it) }
          response.put("badges", list); invoke.resolve(response)
        }
      }, args.timeoutMs.coerceIn(100,10000))
    } catch (e: Exception) { activeScanInvoke = null; activeScan = null; invoke.reject(e.message ?: "Could not scan for badges.") }
  } }
  @Command fun send(invoke: Invoke) { if (permitted(invoke, "sendGranted")) beginSend(invoke) }
  @PermissionCallback fun sendGranted(invoke: Invoke) {
    if (getPermissionState(alias()) == PermissionState.GRANTED) beginSend(invoke)
    else invoke.reject("Bluetooth permission was denied; enable it in app settings.")
  }
  private fun beginSend(invoke: Invoke) { main.post {
    try {
      if (activeScanInvoke != null || sendInvoke != null) { invoke.reject("A device operation is already running."); return@post }
      adapter()
      val args = invoke.parseArgs(BadgeSendArgs::class.java)
      val device = devices[args.deviceId] ?: throw IllegalStateException("Find the badge again before sending.")
      stock = Base64.decode(args.stock, Base64.NO_WRAP); magic = Base64.decode(args.magic, Base64.NO_WRAP)
      if (stock.size !in 64..8192 || magic.size !in 64..8192) throw IllegalArgumentException("Invalid badge payload.")
      sendInvoke = invoke; offset = 0; metadata = ""; infoQueue.clear()
      totalTimeout = Runnable { fail("The transfer timed out; press badge button 1 and retry from the start.") }
      main.postDelayed(totalTimeout!!, 90000)
      arm(20000, "Connecting timed out; press badge button 1 and retry.")
      gatt = device.connectGatt(host, false, callbacks, BluetoothDevice.TRANSPORT_LE)
      if (gatt == null) fail("Could not connect to this badge.")
    } catch (e: Exception) { if (sendInvoke === invoke) fail(e.message ?: "Could not send to the badge.") else invoke.reject(e.message ?: "Could not send to the badge.") }
  } }
  private val callbacks = object: BluetoothGattCallback() {
    override fun onConnectionStateChange(device: BluetoothGatt, status: Int, state: Int) { main.post {
      if (gatt !== device || sendInvoke == null) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) { fail("Bluetooth connection failed ($status); press badge button 1 and retry."); return@post }
      if (state == BluetoothProfile.STATE_CONNECTED) {
        arm(10000, "Bluetooth service discovery timed out.")
        if (!device.discoverServices()) fail("Could not discover badge services.")
      } else if (state == BluetoothProfile.STATE_DISCONNECTED) fail("The badge disconnected; press button 1 and resend from the start.")
    } }
    override fun onServicesDiscovered(device: BluetoothGatt, status: Int) { main.post {
      if (gatt !== device || sendInvoke == null) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) { fail("Could not discover badge services."); return@post }
      output = device.getService(service)?.getCharacteristic(writeId)
      if (output == null || output!!.properties and BluetoothGattCharacteristic.PROPERTY_WRITE == 0) { fail("This device does not expose the badge write service."); return@post }
      val info = device.getService(infoId)
      for (id in listOf("00002a29", "00002a24")) info?.getCharacteristic(UUID.fromString("$id-0000-1000-8000-00805f9b34fb"))?.let { infoQueue.add(it) }
      readNext()
    } }
    @Deprecated("Legacy callback")
    override fun onCharacteristicRead(device: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      if (Build.VERSION.SDK_INT < 33) readResult(device, characteristic.value, status)
    }
    override fun onCharacteristicRead(device: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) { readResult(device, value, status) }
    override fun onCharacteristicWrite(device: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) { main.post {
      if (gatt !== device || sendInvoke == null) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) {
        fail(if (status == 5 || status == 15) "The badge requires pairing; disable its PIN security and try again." else "Write failed ($status); press button 1 and resend from the start.")
        return@post
      }
      offset += 16
      if (offset >= payload.size) succeed() else writeNext()
    } }
  }
  private fun readResult(device: BluetoothGatt, value: ByteArray?, status: Int) { main.post {
    if (gatt !== device || sendInvoke == null) return@post
    if (status == BluetoothGatt.GATT_SUCCESS && value != null) metadata += " " + String(value, Charsets.UTF_8).lowercase()
    readNext()
  } }
  private fun readNext() {
    if (sendInvoke == null) return
    if (infoQueue.isEmpty()) {
      payload = if (metadata.contains("badgemagic") || metadata.contains("badge magic") || metadata.contains("fossasia") || metadata.contains("bm1144")) magic else stock
      writeNext(); return
    }
    val next = infoQueue.removeFirst()
    arm(8000, "Firmware detection timed out; press badge button 1 and retry.")
    try { if (gatt?.readCharacteristic(next) != true) readNext() } catch (e: Exception) { fail(e.message ?: "Could not read firmware information.") }
  }
  private fun writeNext() {
    val device = gatt ?: return
    val characteristic = output ?: return
    arm(8000, "The badge stopped acknowledging writes; press button 1 and resend from the start.")
    val bytes = payload.copyOfRange(offset, minOf(offset + 16, payload.size))
    try {
      val accepted = if (Build.VERSION.SDK_INT >= 33) device.writeCharacteristic(characteristic, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
      else { characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT; characteristic.value = bytes; device.writeCharacteristic(characteristic) }
      if (!accepted) fail("The Bluetooth stack rejected this write; reconnect and retry.")
    } catch (e: Exception) { fail(e.message ?: "Could not write to the badge.") }
  }
  private fun arm(ms: Long, message: String) {
    timeout?.let { main.removeCallbacks(it) }
    timeout = Runnable { fail(message) }; main.postDelayed(timeout!!, ms)
  }
  private fun cleanup(): Invoke? {
    timeout?.let { main.removeCallbacks(it) }; totalTimeout?.let { main.removeCallbacks(it) }
    timeout = null; totalTimeout = null
    val call = sendInvoke; sendInvoke = null
    val device = gatt; gatt = null; output = null
    try { device?.disconnect() } catch (_: Exception) {}
    try { device?.close() } catch (_: Exception) {}
    return call
  }
  private fun fail(message: String) { cleanup()?.reject(message) }
  private fun succeed() { val bytes = payload.size; val call = cleanup(); val reply = JSObject(); reply.put("bytes", bytes); call?.resolve(reply) }
}
