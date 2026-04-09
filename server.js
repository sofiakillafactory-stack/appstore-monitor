const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cron = require("node-cron");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

// ─── Конфигурация ─────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = "7943665527";

const CHECK_INTERVAL = "*/2 * * * *";
const GEOS = ["us", "ru", "jp", "de"];

// ─── Хранилище ────────────────────────────────────────────

const APPS_FILE = path.join(__dirname, "apps.json");

function loadApps() {
  try {
    if (!fs.existsSync(APPS_FILE)) {
      fs.writeFileSync(APPS_FILE, "[]", "utf8");
    }
    const raw = fs.readFileSync(APPS_FILE, "utf8");
    const data = JSON.parse(raw);
    apps.length = 0;
    apps.push(...data);
    log(`Загружено ${apps.length} приложений из apps.json`);
  } catch (err) {
    log("Ошибка загрузки apps.json: " + err.message);
  }
}

function saveApps() {
  try {
    fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), "utf8");
  } catch (err) {
    log("Ошибка сохранения apps.json: " + err.message);
  }
}

const apps = [];

// ─── Вспомогательные функции ─────────────────────────────

function log(message) {
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
}

async function sendTelegramMessage(text) {
  if (!TELEGRAM_TOKEN) {
    log("Нет TELEGRAM_TOKEN, сообщение не отправлено");
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
    });
    log("📲 Telegram отправлен");
  } catch (error) {
    log(`Ошибка Telegram: ${error.message}`);
  }
}

function generateGeoUrls(baseUrl) {
  return GEOS.map((geo) => baseUrl.replace("/us/", `/${geo}/`));
}

function getTimeHHMM() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// ─── Проверка ─────────────────────────────────────────────

async function checkApp(app) {
  if (app.released) return;

  for (const geoApp of app.geos) {
    log(`Проверяю: ${geoApp.url}`);

    try {
      const response = await axios.get(geoApp.url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      const html = response.data;

      const notAvailable =
        html.includes("App Not Available") ||
        html.includes("app is not available") ||
        html.includes("This app is not available");

      if (notAvailable) continue;

      const geo = geoApp.url.split("/")[3];
      const releaseTime = getTimeHHMM();

      log(`🚀 Релиз найден в ${geo.toUpperCase()}`);

      await sendTelegramMessage(
        `🚀 РЕЛИЗ!\n🌍 GEO: ${geo.toUpperCase()}\n🕐 Время: ${releaseTime}\n🔗 ${geoApp.url}`
      );

      geoApp.released = true;
      geoApp.releaseTime = releaseTime;

      // Если хотя бы в одном GEO вышло — считаем общим релизом
      app.released = true;
      app.releaseTime = releaseTime;
      saveApps();
      return;

    } catch (error) {
      log(`Ошибка (${geoApp.url}): ${error.message}`);
    }
  }
}

async function checkAllApps() {
  if (apps.length === 0) {
    log("Список пуст");
    return;
  }

  log(`Проверяю ${apps.length} приложений`);

  for (const app of apps) {
    await checkApp(app);
  }
}

// ─── API ─────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Добавление
app.post("/add", (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Нужно указать ID или ссылку" });
  }

  if (/^\d+$/.test(url)) {
    url = `https://apps.apple.com/us/app/id${url}`;
  }

  if (!url.includes("/us/app/")) {
    return res.status(400).json({ error: "Нужен ID или ссылка App Store" });
  }

  const exists = apps.find((a) => a.baseUrl === url);
  if (exists) {
    return res.status(409).json({ error: "Уже добавлено" });
  }

  const geoUrls = generateGeoUrls(url).map((u) => ({
    url: u,
    released: false,
    releaseTime: null,
  }));

  apps.push({
    baseUrl: url,
    geos: geoUrls,
    released: false,
    releaseTime: null,
  });

  log(`Добавлено: ${url}`);
  saveApps();
  res.json({ message: "Добавлено", geos: geoUrls });
});

// Список
app.get("/list", (req, res) => {
  res.json(apps);
});

// Удаление
app.delete("/remove", (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Нужно указать url" });
  }

  const index = apps.findIndex((a) => a.baseUrl === url);

  if (index === -1) {
    return res.status(404).json({ error: "Не найдено" });
  }

  apps.splice(index, 1);
  log(`Удалено: ${url}`);
  saveApps();
  res.json({ message: "Удалено" });
});

// Ручная проверка
app.post("/check", async (req, res) => {
  log("Ручная проверка запущена");
  checkAllApps().catch(err => {
    log("Ошибка ручной проверки: " + err.message);
  });
  res.json({ message: "Проверка запущена" });
});

// ─── Запуск ──────────────────────────────────────────────

cron.schedule(CHECK_INTERVAL, checkAllApps);

app.listen(PORT, () => {
  log(`Сервер запущен на порту ${PORT}`);
  loadApps();
  log("🚀 Сервер полностью готов");
});
