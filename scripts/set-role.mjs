#!/usr/bin/env node
/**
 * 設定 Firebase Auth 使用者的自訂聲明（role）
 * 
 * 使用方式：
 *   node scripts/set-role.mjs <email> <role>
 * 
 * 例如：
 *   node scripts/set-role.mjs teacher@example.com teacher
 *   node scripts/set-role.mjs admin@example.com admin
 */

// 🔥 改用模組化導入（firebase-admin v10+）
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const email = process.argv[2];
const role = process.argv[3];

if (!email || !role) {
  console.error('❌ 使用方式：node scripts/set-role.mjs <email> <role>');
  console.error('   範例：node scripts/set-role.mjs teacher@example.com teacher');
  process.exit(1);
}

if (!['teacher', 'admin'].includes(role)) {
  console.error('❌ role 只能是 "teacher" 或 "admin"');
  process.exit(1);
}

// 讀取 service account 金鑰
const keyPath = path.join(__dirname, '..', 'service-account.json');
if (!fs.existsSync(keyPath)) {
  console.error('❌ 找不到 service-account.json');
  console.error('   請到 Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰');
  console.error('   下載後存為 service-account.json 放在專案根目錄');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));

// 🔥 初始化 Firebase Admin
const app = initializeApp({
  credential: cert(serviceAccount),
});

async function main() {
  try {
    const user = await getAuth(app).getUserByEmail(email);
    await getAuth(app).setCustomUserClaims(user.uid, { role });
    console.log(`✅ 已為 ${email} 設定角色：${role}`);
    console.log(`   UID: ${user.uid}`);
    console.log('');
    console.log('⚠️ 使用者需要重新登入（或重新整理頁面），新的 role 才會生效。');
  } catch (error) {
    console.error('❌ 設定失敗:', error.message);
  }
  process.exit(0);
}

main();