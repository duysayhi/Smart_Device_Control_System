import { execFile } from 'node:child_process';
import { Action } from '@/lib/validators/action-plan.schema';
import { AndroidAdbDevice, AndroidAdbStatus } from '@/types/device';
import { createAndroidExecutor } from './executor';

const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function runAdb(args: string[], timeoutMs = 20000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'adb',
      args,
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export function isValidAndroidSerial(serial: string): boolean {
  return SERIAL_PATTERN.test(serial);
}

async function getAdbOutput(serial: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await runAdb(['-s', serial, ...args]);
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function listAndroidDevices(): Promise<AndroidAdbDevice[]> {
  const { stdout } = await runAdb(['devices', '-l']);

  return stdout
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line): AndroidAdbDevice[] => {
      const match = line.trim().match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
      if (!match || !isValidAndroidSerial(match[1])) return [];

      const [, serial, rawStatus, metadata = ''] = match;
      const status: AndroidAdbStatus =
        rawStatus === 'device' || rawStatus === 'offline' || rawStatus === 'unauthorized'
          ? rawStatus
          : 'unknown';
      const model = metadata.match(/(?:^|\s)model:([^\s]+)/)?.[1]?.replace(/_/g, ' ') || serial;

      return [{
        serial,
        model,
        status,
        connectionType: serial.includes(':') ? 'Wi-Fi' : 'USB',
      }];
    });
}

export async function readAndroidDeviceDetails(device: AndroidAdbDevice): Promise<AndroidAdbDevice> {
  if (device.status !== 'device') return device;

  const [androidRelease, batteryOutput, sizeOutput, networkOutput] = await Promise.all([
    getAdbOutput(device.serial, ['shell', 'getprop', 'ro.build.version.release']),
    getAdbOutput(device.serial, ['shell', 'dumpsys', 'battery']),
    getAdbOutput(device.serial, ['shell', 'wm', 'size']),
    getAdbOutput(device.serial, ['shell', 'ip', '-o', '-4', 'addr', 'show', 'wlan0']),
  ]);
  const batteryMatch = batteryOutput.match(/\blevel:\s*(\d+)/);
  const sizeMatch = sizeOutput.match(/(?:Physical|Override) size:\s*(\d+)x(\d+)/);
  const ipMatch = networkOutput.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//);

  return {
    ...device,
    ...(androidRelease ? { osVersion: `Android ${androidRelease}` } : {}),
    ...(batteryMatch ? { batteryLevel: Number(batteryMatch[1]) } : {}),
    ...(sizeMatch ? { resolution: `${sizeMatch[1]} x ${sizeMatch[2]}` } : {}),
    ...(ipMatch ? { ipAddress: ipMatch[1] } : {}),
  };
}

export async function captureAndroidScreenshot(serial: string): Promise<Buffer> {
  if (!isValidAndroidSerial(serial)) {
    throw new Error('Serial thiết bị không hợp lệ.');
  }

  return new Promise((resolve, reject) => {
    execFile(
      'adb',
      ['-s', serial, 'exec-out', 'screencap', '-p'],
      {
        encoding: 'buffer',
        maxBuffer: 16 * 1024 * 1024,
        shell: false,
        timeout: 20000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.toString().trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

export async function executeAndroidAction(serial: string, action: Action): Promise<void> {
  if (!isValidAndroidSerial(serial)) {
    throw new Error('Serial thiết bị không hợp lệ.');
  }

  await androidExecutor.execute(serial, action);
}

const androidExecutor = createAndroidExecutor(runAdb);

export async function preflightAndroidPlan(serial: string, actions: Action[]): Promise<void> {
  if (!isValidAndroidSerial(serial)) throw new Error('Invalid device serial.');
  await androidExecutor.preflight(serial, actions);
}
