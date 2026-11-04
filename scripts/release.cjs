// 發佈新版本到 GitHub Release（自動更新和下載網址都從這裡抓檔案）
//
// 用法（先把 package.json、src-tauri/tauri.conf.json、src-tauri/Cargo.toml 的版本號改好，並 commit、push）：
//   1. 打包：設好簽章私鑰的環境變數後執行 npm run build:app
//        TAURI_SIGNING_PRIVATE_KEY = C:\Users\kosak\.tauri\vn-script-editor.key
//        TAURI_SIGNING_PRIVATE_KEY_PASSWORD = 私鑰的密碼
//   2. 發佈：node scripts/release.cjs "這一版的更新內容"
//
// 會上傳四個檔案到 v版本號 這個 Release：
//   VN-Script-Editor_版本_x64-setup.exe（安裝檔）、.sig（簽章）
//   latest.json（程式啟動時讀這個，判斷有沒有新版本）
//   VN-Script-Editor-setup.exe（固定檔名的同一個安裝檔：下面這個網址永遠下載到最新版）
//   https://github.com/ChenghsichengGit/vn-script-editor/releases/latest/download/VN-Script-Editor-setup.exe
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'ChenghsichengGit/vn-script-editor';
const root = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version;
const notes = process.argv[2] || `版本 ${version}`;

// tauri build 產生的安裝檔和簽章（檔名有空白，上傳時換成沒有空白的名字）
const bundle = path.join(root, 'src-tauri/target/release/bundle/nsis');
const builtExe = path.join(bundle, `VN Script Editor_${version}_x64-setup.exe`);
if (!fs.existsSync(builtExe) || !fs.existsSync(`${builtExe}.sig`)) {
  console.error(`找不到 ${version} 版的安裝檔或簽章，請先執行 npm run build:app（要設好簽章私鑰的環境變數）`);
  process.exit(1);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), `vn-release-${version}-`));
const exe = `VN-Script-Editor_${version}_x64-setup.exe`;
const signature = fs.readFileSync(`${builtExe}.sig`, 'utf8').trim();
fs.copyFileSync(builtExe, path.join(out, exe));
fs.copyFileSync(builtExe, path.join(out, 'VN-Script-Editor-setup.exe'));
fs.writeFileSync(path.join(out, `${exe}.sig`), signature);
fs.writeFileSync(
  path.join(out, 'latest.json'),
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        'windows-x86_64': { signature, url: `https://github.com/${REPO}/releases/download/v${version}/${exe}` },
      },
    },
    null,
    2,
  ),
);

const files = [exe, `${exe}.sig`, 'latest.json', 'VN-Script-Editor-setup.exe'].map((f) => path.join(out, f));
const body = `${notes}\n\n下載安裝：[VN-Script-Editor-setup.exe](https://github.com/${REPO}/releases/latest/download/VN-Script-Editor-setup.exe)`;
execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--repo', REPO, '--target', 'main', '--title', `VN Script Editor ${version}`, '--notes', body], {
  stdio: 'inherit',
});
console.log(`已發佈 v${version}`);
