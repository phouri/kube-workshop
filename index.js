const express = require('express');
const app = express();
const mysql = require('mysql2/promise');

const start = function () {
  app.listen('8005', (err) => {
    if (err) {
      console.error('Error starting app', err);
    } else {
      console.log('Listening on 8005');
    }
  });
}
let connection;
async function setup() {
  try {
    connection = await mysql.createConnection({
      host: 'mysql',
      user: process.env.MYSQL_ROOT_USER,
      password: process.env.MYSQL_ROOT_PASSWORD
    });
    await connection.query('CREATE DATABASE IF NOT EXISTS demo');
    await connection.query('USE demo');
    await connection.query(`CREATE TABLE IF NOT EXISTS users(
      id INT NOT NULL AUTO_INCREMENT,
      PRIMARY KEY(id),
      name VARCHAR(30)
    )`);
    start();
  } catch (e) {
    console.error('Error setting up db', e);
  }
}

app.post('/add_user', async (req, res) => {
  try {
    if (!req.query.name) {
      res.status(400).send('Send name query param please');
    }
    await connection.query(`INSERT INTO users (name) VALUES(?)`, [req.query.name]);
    res.send('OK');
  } catch(e) {
    console.error('Error inserting user', e);
    res.status(500).send('Error');
  }
});

app.get('/users', async (req, res) => {
  try {
    const [users] = await connection.execute('SELECT * FROM users LIMIT 30');
    res.send(users);
  } catch (e) {
    console.error('Error fetching users', e);
    res.status(500).end();
  }
});


const now = Date.now();

app.get('/_healthz', (req, res) => {
  res.send('OK');
});


app.get('/_readyz', (req, res) => {
  console.log('Readycheck');
  if (Date.now() - now > 4000) {
    res.send('OK');
  }  else {
    res.status(500).end();
  }
});

app.get('/api', (req, res) => {
  for (let i = 0; i < 1e4; i++) {
    let a = process.env;
  }
  res.send({
    api: 'v1',
  });
});

app.all('*', (req, res) => {
  res.send('Generic 404 Message');
});

setup();