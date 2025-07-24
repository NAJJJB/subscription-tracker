const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("subs.db");

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, webhookUrl TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS subscriptions (userId TEXT, name TEXT, price REAL, renewsAt TEXT, notifyDays INTEGER, renewalFrequency TEXT)");
  
  // Add new columns to existing table if they don't exist
  db.run("ALTER TABLE subscriptions ADD COLUMN renewsAt TEXT", () => {});
  db.run("ALTER TABLE subscriptions ADD COLUMN notifyDays INTEGER", () => {});
  db.run("ALTER TABLE users ADD COLUMN webhookUrl TEXT", () => {});
  db.run("ALTER TABLE subscriptions ADD COLUMN renewalFrequency TEXT", () => {});
  db.run("ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'USD'", () => {});
});

module.exports = {
  addUser: (id, name) => {
    db.run("INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)", [id, name]);
  },
  addSubscription: (userId, name, price, renewsAt, notifyDays, renewalFrequency) => {
    db.run("INSERT INTO subscriptions (userId, name, price, renewsAt, notifyDays, renewalFrequency) VALUES (?, ?, ?, ?, ?, ?)", [userId, name, price, renewsAt, notifyDays, renewalFrequency]);
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
  },
  updateSubscription: (userId, oldName, name, price, renewsAt, notifyDays, renewalFrequency) => {
    return new Promise((resolve, reject) => {
      db.run("UPDATE subscriptions SET name = ?, price = ?, renewsAt = ?, notifyDays = ?, renewalFrequency = ? WHERE userId = ? AND name = ?", 
        [name, price, renewsAt, notifyDays, renewalFrequency, userId, oldName], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  },
  updateUserWebhook: (userId, webhookUrl) => {
    return new Promise((resolve, reject) => {
      db.run("UPDATE users SET webhookUrl = ? WHERE id = ?", [webhookUrl, userId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  },
  getUserWebhook: (userId) => {
    return new Promise((resolve, reject) => {
      db.get("SELECT webhookUrl FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.webhookUrl : null);
      });
    });
  },
  getSubscriptionsDueForNotification: () => {
    return new Promise((resolve, reject) => {
      const today = new Date();
      const query = `
        SELECT s.*, u.name as userName, u.webhookUrl 
        FROM subscriptions s 
        JOIN users u ON s.userId = u.id 
        WHERE u.webhookUrl IS NOT NULL 
        AND s.renewsAt IS NOT NULL 
        AND s.notifyDays IS NOT NULL
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else {
          const dueNotifications = rows.filter(sub => {
            const renewDate = new Date(sub.renewsAt);
            const notifyDate = new Date(renewDate);
            notifyDate.setDate(renewDate.getDate() - sub.notifyDays);
            
            // Check if today is the notification date
            return today.toDateString() === notifyDate.toDateString();
          });
          resolve(dueNotifications);
        }
      });
    });
  },
  getAllWebhooks: () => {
    return new Promise((resolve, reject) => {
      db.all("SELECT id, name, webhookUrl FROM users WHERE webhookUrl IS NOT NULL AND webhookUrl != ''", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  getAdminStats: () => {
    return new Promise((resolve, reject) => {
      const queries = [
        "SELECT COUNT(*) as totalUsers FROM users",
        "SELECT COUNT(*) as usersWithWebhooks FROM users WHERE webhookUrl IS NOT NULL AND webhookUrl != ''",
        "SELECT COUNT(*) as totalSubscriptions FROM subscriptions"
      ];
      
      Promise.all(queries.map(query => 
        new Promise((res, rej) => {
          db.get(query, [], (err, row) => {
            if (err) rej(err);
            else res(row);
          });
        })
      )).then(results => {
        resolve({
          totalUsers: results[0].totalUsers,
          usersWithWebhooks: results[1].usersWithWebhooks,
          totalSubscriptions: results[2].totalSubscriptions
        });
      }).catch(reject);
    });
  },
  getUserPreferences: (userId) => {
    return new Promise((resolve, reject) => {
      db.get("SELECT webhookUrl, currency FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row || { webhookUrl: null, currency: 'USD' });
      });
    });
  },
  updateUserCurrency: (userId, currency) => {
    return new Promise((resolve, reject) => {
      db.run("UPDATE users SET currency = ? WHERE id = ?", [currency, userId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  },
  updateUserPreferences: (userId, webhookUrl, currency) => {
    return new Promise((resolve, reject) => {
      db.run("UPDATE users SET webhookUrl = ?, currency = ? WHERE id = ?", [webhookUrl, currency, userId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
};
