/**
 * Human-like WhatsApp send via ADB: open chat, clear compose, type, TAP SEND.
 * Usage: node scripts/wa-adb-send.mjs com.whatsapp "visits today"
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB_PATH || String.raw`C:\Users\kiran\Downloads\platform-tools-latest-windows (1)\platform-tools\adb.exe`;
const SERIAL = process.env.ANDROID_SERIAL || 'RZGL31RFPAV';
const PALM = process.env.PALM_WHATSAPP_PHONE || '15551642552';
const UI = path.join(process.env.TEMP || '/tmp', 'wa-ui.xml');
const pkg = process.argv[2] || 'com.whatsapp';
const msg = process.argv.slice(3).join(' ');

function adb(...args) {
  try {
    return execSync(`"${ADB}" -s ${SERIAL} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return e.stdout || '';
  }
}

function sleep(ms) {
  execSync(`powershell -Command "Start-Sleep -Milliseconds ${ms}"`, { stdio: 'ignore' });
}

function dumpUi() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/wa-ui.xml');
  adb('pull', '/sdcard/wa-ui.xml', UI);
  return fs.readFileSync(UI, 'utf8');
}

function tapBounds(match) {
  const cx = Math.floor((+match[1] + +match[3]) / 2);
  const cy = Math.floor((+match[2] + +match[4]) / 2);
  adb('shell', 'input', 'tap', String(cx), String(cy));
  return { cx, cy };
}

function entryText(xml) {
  const m =
    xml.match(/resource-id="com\.whatsapp:id\/entry"[^>]*text="([^"]*)"/)
    || xml.match(/resource-id="com\.whatsapp\.w4b:id\/entry"[^>]*text="([^"]*)"/);
  return m ? m[1] : '';
}

console.log(`Sending [${pkg}]: "${msg}"`);

adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `https://wa.me/${PALM}`, pkg);
sleep(5000);
adb('shell', 'input', 'swipe', '720', '900', '720', '2400', '400');
sleep(800);

let xml = dumpUi();
const entryBounds =
  xml.match(/resource-id="com\.whatsapp:id\/entry"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  || xml.match(/resource-id="com\.whatsapp\.w4b:id\/entry"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (entryBounds) tapBounds(entryBounds);
sleep(400);
for (let i = 0; i < 80; i++) adb('shell', 'input', 'keyevent', '67');
sleep(300);

const encoded = msg.replace(/ /g, '%s');
adb('shell', 'input', 'text', encoded);
sleep(700);

xml = dumpUi();
const sendBounds =
  xml.match(/resource-id="com\.whatsapp:id\/send"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  || xml.match(/resource-id="com\.whatsapp\.w4b:id\/send"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  || xml.match(/content-desc="Send"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (!sendBounds) {
  console.error('FAIL: send button not found');
  process.exit(2);
}
tapBounds(sendBounds);
sleep(2000);

xml = dumpUi();
const after = entryText(xml);
const sent = !after.trim();
console.log(JSON.stringify({ sent, msg, entryAfter: after || '(empty)' }, null, 2));
process.exit(sent ? 0 : 1);
