# 🔐 帳號管理指南

本文件說明如何為教師與管理員建立帳號、設定角色。

> **重要**：目前只有管理員能建立帳號，教師無法自行註冊。

---

## 📋 角色種類

| 角色 | 說明 | 建立方式 |
|------|------|---------|
| `student` | 學生（匿名登入） | 自動，無需建立 |
| `teacher` | 教師 | 管理員手動建立 |
| `admin` | 管理員 | 管理員手動建立 |

學生使用**匿名登入**，系統自動產生 UID，無需管理員介入。

---

## 🛠️ 前置準備

### 1. 確認 `service-account.json` 存在

在專案根目錄應該有 `service-account.json`：

```
vocab-handwriting-trainer/
├── service-account.json   ← 這個檔案
├── scripts/
│   └── set-role.mjs
└── ...
```

**如果沒有這個檔案**：

1. Firebase Console → 專案設定 → 服務帳戶
2. 點「**產生新的私密金鑰**」
3. 下載 JSON 檔案，改名為 `service-account.json`
4. 放在專案根目錄

⚠️ **這個檔案是機密，絕對不能 commit 到 Git**。確認 `.gitignore` 有：

```
service-account.json
```

### 2. 確認環境

```bash
node --version   # 需要 v18 以上
```

---

## 👨‍🏫 建立教師帳號

### 步驟 1：在 Firebase Console 建立使用者

1. 打開 [Firebase Console](https://console.firebase.google.com/)
2. 進入你的專案 → **Authentication**
3. 點 **Users** 頁籤 → **Add user** 按鈕
4. 輸入教師的 email 與密碼：

   ```
   Email:    teacher@school.edu.tw
   Password: （給老師的臨時密碼，建議 8 字元以上）
   ```

5. 點「**Add user**」

   **建立完成後，複製 email**（不需要複製 UID）。

### 步驟 2：設定角色

在專案根目錄執行：

```bash
node scripts/set-role.mjs teacher@school.edu.tw teacher
```

**預期輸出**：

```
✅ 已為 teacher@school.edu.tw 設定角色：teacher
   UID: xxxxxxxxxxxxxxxxxxxxx

⚠️ 使用者需要重新登入（或重新整理頁面），新的 role 才會生效。
```

### 步驟 3：通知老師

將 **email + 密碼** 交給老師，並請他：

1. 打開網站 → 點「教師後台」
2. 用你提供的帳密登入
3. **如果看不到教師後台** → 請他**重新整理頁面**（Ctrl+Shift+R）

> 💡 **為什麼要重新整理？**
>
> Firebase 的 custom claims 需要「重新取得 ID token」才會生效。
> 你的 `AuthContext` 使用 `getIdTokenResult(true)` 強制刷新，
> 所以重新整理頁面就夠了，不需要登出再登入。

---

## 👑 建立管理員帳號

流程與教師帳號相同，只是角色改為 `admin`：

```bash
node scripts/set-role.mjs admin@yourdomain.com admin
```

管理員可以：

- 上傳單字庫（AdminPanel）
- 刪除歸檔學生資料（尚未實作）
- 所有教師能做的事

---

## 🔍 驗證設定是否成功

### 方法 1：看 Console log

老師登入後，打開 F12 → Console，應該看到：

```
🔐 [AuthContext] onAuthStateChanged: xxxxxxxxx
🔐 [AuthContext] 角色：teacher
```

如果看到 `⚠️ 已登入但沒有角色`，代表 `set-role.mjs` 沒有成功，或需要重新整理頁面。

### 方法 2：用 Admin SDK 查詢

```bash
node -e "
import('firebase-admin/app').then(async ({ initializeApp, cert }) => {
  const fs = await import('fs');
  const sa = JSON.parse(fs.readFileSync('./service-account.json', 'utf-8'));
  const app = initializeApp({ credential: cert(sa) });
  const { getAuth } = await import('firebase-admin/auth');
  const user = await getAuth(app).getUserByEmail('teacher@school.edu.tw');
  console.log('UID:', user.uid);
  console.log('Custom Claims:', user.customClaims);
});
"
```

**預期輸出**：

```
UID: xxxxxxxxxxxxxxxxxxxxx
Custom Claims: { role: 'teacher' }
```

---

## 🐛 常見問題

### Q1：老師登入後看不到教師後台

**原因**：custom claims 未生效，或 token 未更新。

**解法**：

1. 請老師**重新整理頁面**（Ctrl+Shift+R）
2. 若仍未生效 → 請老師**登出再登入**
3. 若仍未生效 → 檢查 `set-role.mjs` 是否成功執行

### Q2：`set-role.mjs` 執行失敗

**錯誤：找不到 service-account.json**

→ 參考「前置準備」章節下載金鑰。

**錯誤：User not found**

→ 表示這個 email 還沒在 Firebase Authentication 建立，先執行「步驟 1」。

**錯誤：PERMISSION_DENIED**

→ service-account.json 權限不足，重新下載一次。

### Q3：如何移除老師的角色？

```bash
node scripts/set-role.mjs teacher@school.edu.tw student
```

或直接在 Firebase Console 刪除該使用者。

⚠️ **注意**：直接改為 `student` 會讓老師無法再登入教師後台，但帳號本身還在。

### Q4：如何重設老師密碼？

方法 1（推薦）：請老師在登入頁面點「忘記密碼」，系統寄送重設信。

方法 2（管理員手動）：

1. Firebase Console → Authentication → Users
2. 找到該老師 → 右邊三點 → **Reset password**
3. 或直接刪除重建

---

## 📊 角色對照表

| 功能 | student | teacher | admin |
|------|---------|---------|-------|
| 學生登入練習 | ✅ | ❌ | ❌ |
| 查看教師後台 | ❌ | ✅ | ✅ |
| 建立作業 | ❌ | ✅ | ✅ |
| 上傳單字庫 | ❌ | ❌ | ✅ |
| 歸檔學生 | ❌ | ✅ | ✅ |
| 刪除歸檔學生 | ❌ | ❌ | ✅（待實作） |

---

## 🔒 安全提醒

1. **`service-account.json` 絕對不能上傳 Git**
   - 這個檔案等於專案的萬能鑰匙
   - 如果洩漏，任何人都能操控你的 Firebase 專案

2. **教師密碼請用臨時密碼**
   - 建議格式：`Temp-` + 隨機 6 碼，例如 `Temp-a8k3x9`
   - 請老師首次登入後自行修改

3. **定期檢查使用者清單**
   - 離職教師應立即刪除帳號
   - Firebase Console → Authentication → Users → 手動審核

---

## 📚 相關檔案

| 檔案 | 用途 |
|------|------|
| `scripts/set-role.mjs` | 設定角色 |
| `src/contexts/AuthContext.tsx` | 前端讀取角色 |
| `service-account.json` | Admin SDK 金鑰（機密） |
| `firestore.rules` | Firestore 權限規則 |

---

## 🎯 快速指令速查

```bash
# 建立教師
node scripts/set-role.mjs teacher@school.edu.tw teacher

# 建立管理員
node scripts/set-role.mjs admin@yourdomain.com admin

# 移除角色（降為學生）
node scripts/set-role.mjs teacher@school.edu.tw student
```

# 流程確認

1. Firebase Console → Authentication → Add user（輸入 email + password）
2. node scripts/set-role.mjs <email> teacher
3. 告訴老師帳密
4. 老師登入 → 看到教師後台