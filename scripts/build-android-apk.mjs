import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const androidDir = path.join(rootDir, "android");
const cacheDir = path.join(rootDir, ".cache");
const stateFile = path.join(cacheDir, "apk-build-state.json");

function loadEnvFiles() {
  for (const filename of [".env.local", ".env"]) {
    const envPath = path.join(rootDir, filename);
    if (!fs.existsSync(envPath)) continue;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = line.match(/^([^=]+)=(.*)$/);
      if (!match) continue;

      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    variant: "debug",
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--variant=release" || arg === "--release") {
      args.variant = "release";
      continue;
    }
    if (arg === "--variant=debug" || arg === "--debug") {
      args.variant = "debug";
    }
  }

  return args;
}

function detectProjectYear() {
  if (process.env.APK_PROJECT_YEAR) {
    return process.env.APK_PROJECT_YEAR.padStart(2, "0").slice(-2);
  }

  const result = spawnSync("git", ["log", "--reverse", "--format=%ad", "--date=format:%y"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  const year = result.stdout.trim().split(/\r?\n/).find(Boolean);
  if (year) {
    return year.padStart(2, "0").slice(-2);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.APK_TIMEZONE || "Europe/Istanbul",
    year: "2-digit",
  }).format(new Date());
}

function getCurrentMonth(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "2-digit",
  }).format(new Date());
}

function readState() {
  if (!fs.existsSync(stateFile)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExistingSequenceMax(outputDir, appName, period) {
  if (!fs.existsSync(outputDir)) {
    return 0;
  }

  const pattern = new RegExp(`^${escapeRegex(appName)} - V ${escapeRegex(period)}\\.(\\d+)\\.apk$`);
  let max = 0;

  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(pattern);
    if (!match) continue;
    max = Math.max(max, Number(match[1]));
  }

  return max;
}

function ensureAndroidVersionNameHook() {
  const buildGradlePath = path.join(androidDir, "app", "build.gradle");
  if (!fs.existsSync(buildGradlePath)) {
    return;
  }

  const desiredLine = 'versionName (findProperty("appVersionName") ?: System.getenv("APP_VERSION_NAME") ?: "1.0.0")';
  const currentContent = fs.readFileSync(buildGradlePath, "utf8");

  if (currentContent.includes(desiredLine)) {
    return;
  }

  const replacedContent = currentContent.replace(
    /versionName\s+["'][^"']+["']/,
    desiredLine,
  );

  if (replacedContent !== currentContent) {
    fs.writeFileSync(buildGradlePath, replacedContent, "utf8");
  }
}

function runBuild(task, env) {
  const command = process.platform === "win32" ? "cmd.exe" : "./gradlew";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "gradlew.bat", task]
      : [task];

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: androidDir,
      env,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Android build failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

function resolveSourceApk(outputDir, variant) {
  const expectedPath = path.join(outputDir, `app-${variant}.apk`);
  if (fs.existsSync(expectedPath)) {
    return expectedPath;
  }

  const apkFiles = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".apk"))
    .map((entry) => path.join(outputDir, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  return apkFiles[0] || null;
}

function updateOutputMetadata(outputDir, targetFileName) {
  const metadataPath = path.join(outputDir, "output-metadata.json");
  if (!fs.existsSync(metadataPath)) {
    return;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (Array.isArray(metadata.elements) && metadata.elements[0]) {
      metadata.elements[0].outputFile = targetFileName;
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    }
  } catch (error) {
    console.warn(`output-metadata.json guncellenemedi: ${error instanceof Error ? error.message : error}`);
  }
}

function buildTelegramMessage({ appName, versionLabel, targetApkPath, timeZone }) {
  const datePart = new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date());
  const timePart = new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  const dateText = `${datePart} ${timePart}`;
  const targetDirPath = `${path.dirname(targetApkPath)}${path.sep}`;

  return [
    `Proje : ${appName} - V.${versionLabel}`,
    `Tarih : ${dateText}`,
    "",
    "Dosya Adres:",
    targetDirPath,
  ].join("\n");
}

async function sendTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("Telegram ayarlari bulunamadi. Mesaj gonderimi atlandi.");
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const description = payload?.description || response.statusText;
    throw new Error(`Telegram mesaji gonderilemedi: ${description}`);
  }
}

async function main() {
  loadEnvFiles();

  const args = parseArgs(process.argv.slice(2));
  const variant = args.variant;
  const task = variant === "release" ? "assembleRelease" : "assembleDebug";
  const appName = process.env.APK_APP_NAME || "Messenger+";
  const timeZone = process.env.APK_TIMEZONE || "Europe/Istanbul";
  const projectYear = detectProjectYear();
  const currentMonth = getCurrentMonth(timeZone);
  const period = `${projectYear}.${currentMonth}`;
  const outputDir = path.join(androidDir, "app", "build", "outputs", "apk", variant);
  const state = readState();
  const storedMax = Number(state[period] || 0);
  const existingMax = getExistingSequenceMax(outputDir, appName, period);
  const nextSequence = Math.max(storedMax, existingMax) + 1;
  const versionLabel = `${period}.${nextSequence}`;
  const targetFileName = `${appName} - V ${versionLabel}.apk`;
  const targetApkPath = path.join(outputDir, targetFileName);
  const telegramMessage = buildTelegramMessage({ appName, versionLabel, targetApkPath, timeZone });

  console.log(`Hazirlanan APK: ${targetFileName}`);
  console.log(`Telegram mesaji:\n${telegramMessage}`);

  if (args.dryRun) {
    return;
  }

  ensureAndroidVersionNameHook();

  await runBuild(task, {
    ...process.env,
    APP_VERSION_NAME: `V.${versionLabel}`,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const sourceApkPath = resolveSourceApk(outputDir, variant);
  if (!sourceApkPath || !fs.existsSync(sourceApkPath)) {
    throw new Error(`Build tamamlandi ama APK bulunamadi: ${outputDir}`);
  }

  if (path.resolve(sourceApkPath) !== path.resolve(targetApkPath)) {
    fs.renameSync(sourceApkPath, targetApkPath);
  }

  updateOutputMetadata(outputDir, targetFileName);

  state[period] = nextSequence;
  writeState(state);

  await sendTelegramMessage(telegramMessage);

  console.log(`Tamamlandi: ${targetApkPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
