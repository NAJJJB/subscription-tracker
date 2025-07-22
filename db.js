const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("subs.db");

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS subscriptions (userId TEXT, name TEXT, price REAL, renewsAt TEXT, notifyDays INTEGER)");
  
  // Add new columns to existing table if they don't exist
  db.run("ALTER TABLE subscriptions ADD COLUMN renewsAt TEXT", () => {});
  db.run("ALTER TABLE subscriptions ADD COLUMN notifyDays INTEGER", () => {});
});

module.exports = {
  addUser: (id, name) => {
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)", [id, name]);
  },
  addSubscription: (userId, name, price, renewsAt, notifyDays) => {
    db.run("INSERT INTO subscriptions (userId, name, price, renewsAt, notifyDays) VALUES (?, ?, ?, ?, ?)", [userId, name, price, renewsAt, notifyDays]);
  },
  getSubscriptions: (userId) => {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM subscriptions WHERE userId = ?", [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  removeSubscription: (userId, name) => {
    return new Promise((resolve, reject) => {
      db.run("DELETE FROM subscriptions WHERE userId = ? AND name = ?", [userId, name], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
};
