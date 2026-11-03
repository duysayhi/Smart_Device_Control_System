
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");

// ===============================
// PHONE COMMANDER DEV MANAGER
// ===============================

const projectDir = path.resolve(__dirname, "..");
const homeDir = os.homedir();
const logDir = path.join(projectDir, ".dev-logs");

fs.mkdirSync(logDir, { recursive: true });

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ===============================
// KIEM TRA API
// ===============================

async function checkHealth(url, validate) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) return false;

    const data = await response.json();
    return validate(data);
  } catch {
    return false;
  }
}

// ===============================
// KIEM TRA CONG
// ===============================

function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({
      host: "127.0.0.1",
      port,
    });

    let finished = false;

    const done = (busy) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(busy);
    };

    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

// ===============================
// KHOI DONG DICH VU NEN
// ===============================

function startBackground(name, command) {
  const logPath = path.join(
    logDir,
    `${name}.log`
  );

  const fd = fs.openSync(logPath, "a");

  // Chay trong thu muc user Windows.
  // Khong can cd vao project.
  const child = spawn(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", command],
    {
      cwd: homeDir,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    }
  );

  child.on("error", (error) => {
    console.error(
      `[${name}] ${error.message}`
    );
  });

  child.unref();
  fs.closeSync(fd);

  console.log(`[START] ${name}`);
  console.log(`[LOG] ${logPath}`);
}

// ===============================
// DAM BAO DICH VU SAN SANG
// ===============================

async function ensureService(service) {
  console.log(
    `\n[CHECK] ${service.name}`
  );

  // Neu da chay thi dung lai.
  if (await service.check()) {
    console.log(
      `[OK] ${service.name} dang chay`
    );
    return;
  }

  // Neu cong da bi chiem thi khong
  // khoi dong ban thu hai.
  if (await isPortBusy(service.port)) {
    console.log(
      `[WAIT] Cong ${service.port} dang duoc su dung`
    );
  } else {
    startBackground(
      service.name,
      service.command
    );
  }

  // Cho dich vu phan hoi API.
  for (let i = 0; i < 45; i++) {
    await sleep(1000);

    if (await service.check()) {
      console.log(
        `[READY] ${service.name}`
      );
      return;
    }
  }

  throw new Error(
    `${service.name} khong san sang. ` +
    `Kiem tra cong ${service.port} ` +
    `va log tai ${logDir}`
  );
}

// ===============================
// KHOI DONG NEXT.JS
// ===============================

async function startNext() {
  console.log(
    "\n[CHECK] Next.js Dashboard"
  );

  if (await isPortBusy(3000)) {
    throw new Error(
      "Cong 3000 dang duoc su dung. " +
      "Hay kiem tra Next.js cu truoc khi chay."
    );
  }

  console.log(
    "[START] Next.js Dashboard"
  );

  return new Promise((resolve) => {
    const web = spawn(
      process.env.ComSpec || "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "pnpm run dev:web"
      ],
      {
        cwd: projectDir,
        stdio: "inherit",
        windowsHide: false,
      }
    );

    let settled = false;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      process.exitCode = code;
      resolve();
    };

    web.once("error", (error) => {
      console.error(
        `[WEB ERROR] ${error.message}`
      );
      finish(1);
    });

    web.once("exit", (code) => {
      finish(code ?? 1);
    });
  });
}

// ===============================
// MAIN
// ===============================

async function main() {
  console.log(
    "================================="
  );
  console.log(
    " PHONE COMMANDER DEV SERVICES"
  );
  console.log(
    "================================="
  );

  // 1. OLLAMA
  await ensureService({
    name: "ollama",
    port: 11434,
    command: "ollama serve",

    check: () =>
      checkHealth(
        "http://127.0.0.1:11434/api/tags",
        (data) =>
          Array.isArray(data.models)
      ),
  });

  // 2. APPIUM
  await ensureService({
    name: "appium",
    port: 4723,
    command:
      "appium --address 127.0.0.1 --port 4723",

    check: () =>
      checkHealth(
        "http://127.0.0.1:4723/status",
        (data) =>
          data.value?.ready === true
      ),
  });

  // 3. NEXT.JS
  console.log(
    "\n[OK] Ollama va Appium da san sang"
  );

  console.log(
    "[INFO] Dashboard: http://localhost:3000"
  );

  await startNext();
}

main().catch((error) => {
  console.error(
    "\n[DEV ERROR]",
    error.message
  );
  process.exitCode = 1;
});
