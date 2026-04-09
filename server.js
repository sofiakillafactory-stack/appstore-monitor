const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Конфигурация ─────────────────────────────────────────

const PORT = 3000;
const TELEGRAM_TOKEN = "8541538073:AAHpp2cg95Z2xw55HhLRQfPsJm1ZCJzZwDI";
const TELEGRAM_CHAT_ID = "7943665527";

const CHECK_INTERVAL = "*/2 * * * *";
const GEOS = ["us", "ru", "jp", "de"];

// ─── Хранилище ────────────────────────────────────────────

const apps = [];

// ─── Вспомогательные функции ─────────────────────────────

function log(message) {
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
}

async function sendTelegramMessage(text) {
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

      // 🎉 НАШЛИ ПЕРВЫЙ РЕЛИЗ
      const geo = geoApp.url.split("/")[3];

      log(`🚀 Релиз найден в ${geo.toUpperCase()}`);

      await sendTelegramMessage(
        `🚀 РЕЛИЗ!\n🌍 GEO: ${geo.toUpperCase()}\n🔗 ${geoApp.url}`
      );

      app.released = true;
      return;

    } catch (error) {
      log(`Ошибка (${geoApp.url}): ${error.message}`);
    }
  }
}

// ─── Проверка всех приложений ─────────────────────────────

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

// Добавление (ID или ссылка)
app.post("/add", (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Нужно указать ID или ссылку" });
  }

  // если ввели просто цифры — превращаем в ссылку
  if (/^\d+$/.test(url)) {
    url = `https://apps.apple.com/us/app/id${url}`;
  }

  if (!url.includes("/us/app/")) {
    return res.status(400).json({
      error: "Нужен ID или ссылка App Store",
    });
  }

  const exists = apps.find((a) => a.baseUrl === url);
  if (exists) {
    return res.status(409).json({ error: "Уже добавлено" });
  }

  const geoUrls = generateGeoUrls(url).map((u) => ({
    url: u,
    released: false,
  }));

  apps.push({
    baseUrl: url,
    geos: geoUrls,
    released: false,
  });

  log(`Добавлено: ${url}`);

  res.json({ message: "Добавлено", geos: geoUrls });
});

// Список
app.get("/list", (req, res) => {
  res.json(apps);
});

// ─── Запуск ──────────────────────────────────────────────

cron.schedule(CHECK_INTERVAL, checkAllApps);

app.listen(PORT, () => {
  log(`Сервер: http://localhost:${PORT}`);
});