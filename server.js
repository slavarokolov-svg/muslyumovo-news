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

// Банк картинок по тематикам (прямые ссылки на качественные фото)
const imageCategories = {
    default: 'https://images.pexels.com/photos/235725/pexels-photo-235725.jpeg?auto=compress&cs=tinysrgb&w=600',
    accident: 'https://images.pexels.com/photos/2735255/pexels-photo-2735255.jpeg?auto=compress&cs=tinysrgb&w=600',
    school: 'https://images.pexels.com/photos/159775/class-school-school-books-young-159775.jpeg?auto=compress&cs=tinysrgb&w=600',
    harvest: 'https://images.pexels.com/photos/162240/golden-wheat-field-ears-wheat-harvest-162240.jpeg?auto=compress&cs=tinysrgb&w=600',
    politics: 'https://images.pexels.com/photos/596750/pexels-photo-596750.jpeg?auto=compress&cs=tinysrgb&w=600',
    culture: 'https://images.pexels.com/photos/167491/pexels-photo-167491.jpeg?auto=compress&cs=tinysrgb&w=600',
    sport: 'https://images.pexels.com/photos/260024/pexels-photo-260024.jpeg?auto=compress&cs=tinysrgb&w=600',
    nature: 'https://images.pexels.com/photos/158028/bellingrath-gardens-botanical-garden-flower-garden-158028.jpeg?auto=compress&cs=tinysrgb&w=600'
};

function getImageForTitle(title) {
    const lower = title.toLowerCase();
    if (lower.includes('авар') || lower.includes('дтп') || lower.includes('пожар') || lower.includes('чп')) return imageCategories.accident;
    if (lower.includes('школ') || lower.includes('учител') || lower.includes('образован')) return imageCategories.school;
    if (lower.includes('урожай') || lower.includes('агро') || lower.includes('фермер') || lower.includes('сельхоз')) return imageCategories.harvest;
    if (lower.includes('депутат') || lower.includes('правительств') || lower.includes('мин')) return imageCategories.politics;
    if (lower.includes('концерт') || lower.includes('фестиваль') || lower.includes('культур') || lower.includes('праздник')) return imageCategories.culture;
    if (lower.includes('спорт') || lower.includes('футбол') || lower.includes('побед') || lower.includes('турнир')) return imageCategories.sport;
    if (lower.includes('природа') || lower.includes('погод') || lower.includes('экологи')) return imageCategories.nature;
    return imageCategories.default;
}

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

function deleteOldNews() {
    db.run(`DELETE FROM news WHERE created_at < datetime('now', '-7 days')`);
}

function getFallbackNews() {
    const today = new Date().toLocaleDateString('ru-RU');
    return [
        { title: "В Муслюмово обсудили подготовку к Сабантую 2026", date: today, description: "Оргкомитет определил дату праздника - 28 июня. Запланированы скачки, борьба куреш, ярмарка.", source: "Администрация" },
        { title: "Новые автобусы вышли на маршрут Муслюмово - Казань", date: today, description: "Комфортабельные автобусы большого класса будут совершать 4 рейса в день.", source: "Минтранс РТ" },
        { title: "В районе стартовал конкурс «Лучший дом»", date: today, description: "Жителей приглашают принять участие в благоустройстве придомовых территорий.", source: "Совет района" }
    ];
}

async function fetchRealNews() {
    // Расширенный список источников (региональные и федеральные)
    const sources = [
        { url: 'https://www.tatar-inform.ru/rss', name: 'Татар-информ' },
        { url: 'https://kazanfirst.ru/rss', name: 'Казань First' },
        { url: 'https://realnoevremya.ru/rss', name: 'Реальное время' },
        { url: 'http://feeds.bbci.co.uk/news/rss.xml', name: 'BBC' } // запасной, но можно убрать
    ];
    const parser = new xml2js.Parser({ explicitArray: false });
    let allNews = [];

    for (const src of sources) {
        try {
            const response = await axios.get(src.url, { timeout: 10000 });
            const result = await parser.parseStringPromise(response.data);
            let items = result?.rss?.channel?.item || [];
            if (!items.length && result?.feed?.entry) items = result.feed.entry;
            for (let item of items.slice(0, 4)) {
                let title = item.title || '';
                if (!title) continue;
                // Очищаем описание от HTML
                let description = (item.description || item.summary || 'Подробнее на сайте').replace(/<[^>]*>/g, '').slice(0, 300);
                let pubDate = item.pubDate || item.published || item.updated || new Date().toISOString();
                let formattedDate = new Date(pubDate).toLocaleDateString('ru-RU');
                allNews.push({
                    title: title,
                    date: formattedDate,
                    description: description,
                    source: src.name
                });
            }
        } catch(e) {
            console.log('Парсинг ошибка', src.url, e.message);
        }
    }
    // Удаляем дубликаты по заголовку (регистронезависимо)
    const unique = [];
    const titlesSet = new Set();
    for (const n of allNews) {
        const key = n.title.toLowerCase().trim();
        if (!titlesSet.has(key)) {
            titlesSet.add(key);
            unique.push(n);
        }
    }
    console.log(`[ПАРСИНГ] Получено уникальных новостей: ${unique.length}`);
    return unique.slice(0, 15); // не более 15 свежих
}

async function updateNews() {
    console.log('[ОБНОВЛЕНИЕ] Старт');
    deleteOldNews();

    let freshNews = await fetchRealNews();
    if (freshNews.length === 0) {
        console.log('Нет реальных новостей, используем резерв');
        freshNews = getFallbackNews();
    }

    for (const news of freshNews) {
        // Проверка дублей за последние 2 дня
        const exists = await new Promise((resolve) => {
            db.get(`SELECT id FROM news WHERE lower(title) = lower(?) AND created_at > datetime('now', '-2 day')`, [news.title], (err, row) => {
                resolve(!!row);
            });
        });
        if (!exists) {
            const imageUrl = getImageForTitle(news.title);
            db.run(`INSERT INTO news (title, date, description, image_url, source) VALUES (?,?,?,?,?)`,
                [news.title, news.date, news.description, imageUrl, news.source]);
            console.log(`[ДОБАВЛЕНО] ${news.title.slice(0, 60)}`);
        } else {
            console.log(`[ДУБЛЬ] ${news.title.slice(0, 50)}`);
        }
    }
    console.log('[ОБНОВЛЕНИЕ] Готово');
}

app.get('/api/news', (req, res) => {
    db.all(`SELECT * FROM news WHERE created_at > datetime('now', '-7 days') ORDER BY created_at DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`✅ Сервер запущен на порту ${PORT}`);
        updateNews();
        setInterval(updateNews, 24 * 60 * 60 * 1000);
    });
}).catch(err => console.error('БД ошибка:', err));