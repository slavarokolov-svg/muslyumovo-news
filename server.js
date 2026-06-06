const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./news.db');

// Инициализация БД
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.run(`CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            description TEXT NOT NULL,
            image_url TEXT,
            source TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Удаление старых новостей
function deleteOldNews() {
    db.run(`DELETE FROM news WHERE created_at < datetime('now', '-7 days')`);
}

// Резервные новости (с картинками!)
function getFallbackNews() {
    const today = new Date().toLocaleDateString('ru-RU');
    return [
        {
            title: "В Муслюмово обсуждают строительство новой школы",
            date: today,
            description: "Проект рассчитан на 600 мест, начало строительства — 2027 год.",
            image_url: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600",
            source: "Администрация"
        },
        {
            title: "Фермеры района готовятся к весеннему севу",
            date: today,
            description: "Закуплено 200 тонн семян и удобрений.",
            image_url: "https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600",
            source: "ТатАгро"
        },
        {
            title: "Концерт ко Дню Победы прошёл в ДК",
            date: today,
            description: "Выступили местные коллективы и приглашённые артисты.",
            image_url: "https://images.unsplash.com/photo-1517454427005-3ad2b5b9b1b8?w=600",
            source: "Муслюмовский ДК"
        }
    ];
}

// Парсинг RSS (реальные новости)
async function fetchRealNews() {
    const sources = [
        { url: 'https://www.tatar-inform.ru/rss', name: 'Татар-информ' },
        { url: 'https://kazanfirst.ru/rss', name: 'Казань First' }
    ];
    const parser = new xml2js.Parser({ explicitArray: false });
    let allNews = [];

    for (const src of sources) {
        try {
            const response = await axios.get(src.url, { timeout: 10000 });
            const result = await parser.parseStringPromise(response.data);
            let items = result?.rss?.channel?.item || [];
            for (let item of items.slice(0, 3)) {
                if (!item.title) continue;
                let description = (item.description || '').replace(/<[^>]*>/g, '').slice(0, 200);
                if (!description) description = 'Подробнее на сайте';
                allNews.push({
                    title: item.title,
                    date: new Date(item.pubDate).toLocaleDateString('ru-RU'),
                    description: description,
                    image_url: 'https://images.unsplash.com/photo-1563897539633-3f6af64f0dc2?w=600',
                    source: src.name
                });
            }
        } catch(e) {}
    }
    return allNews;
}

// Обновление новостей (без дублей за последние 24 часа)
async function updateNews() {
    console.log('[ОБНОВЛЕНИЕ] Старт');
    deleteOldNews();

    let freshNews = await fetchRealNews();
    if (freshNews.length === 0) {
        freshNews = getFallbackNews();
    }

    for (const news of freshNews) {
        // Проверка: не было ли такой новости за последние 24 часа
        const exists = await new Promise((resolve) => {
            db.get(`SELECT id FROM news WHERE title = ? AND created_at > datetime('now', '-1 day')`, [news.title], (err, row) => {
                resolve(!!row);
            });
        });
        if (!exists) {
            db.run(`INSERT INTO news (title, date, description, image_url, source) VALUES (?,?,?,?,?)`,
                [news.title, news.date, news.description, news.image_url, news.source]);
            console.log(`[ОБНОВЛЕНИЕ] Добавлено: ${news.title.slice(0, 50)}`);
        } else {
            console.log(`[ОБНОВЛЕНИЕ] Дубль пропущен: ${news.title.slice(0, 50)}`);
        }
    }
    console.log('[ОБНОВЛЕНИЕ] Готово');
}

// API
app.get('/api/news', (req, res) => {
    db.all(`SELECT * FROM news WHERE created_at > datetime('now', '-7 days') ORDER BY created_at DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Запуск
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`✅ Сервер на порту ${PORT}`);
        updateNews();
        setInterval(updateNews, 24 * 60 * 60 * 1000);
    });
}).catch(err => console.error('БД ошибка:', err));