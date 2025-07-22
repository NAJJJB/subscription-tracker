const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("subs.db");

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS subscriptions (userId TEXT, name TEXT, price REAL)");
});

module.exports = {
  addUser: (id, name) => {
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)", [id, name]);
  },
  addSubscription: (userId, name, price) => {
    db.run("INSERT INTO subscriptions (userId, name, price) VALUES (?, ?, ?)", [userId, name, price]);
  },
  getSubscriptions: (userId) => {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM subscriptions WHERE userId = ?", [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};
