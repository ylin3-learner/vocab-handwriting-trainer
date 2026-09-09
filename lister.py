import os

def list_all_files(start_path=".", skip_folders=None):
    """
    從指定路徑印出所有檔案（包含最深層），並跳過指定的資料夾。
    
    :param start_path: 開始巡覽的根目錄（預設為當前目錄 "."）
    :param skip_folders: 想要跳過的資料夾名稱集合/列表
    """
    if skip_folders is None:
        # 預設常見要忽略的資料夾
        skip_folders = {".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode"}
    else:
        # 確保轉為 set 以提升比對效率
        skip_folders = set(skip_folders)

    print(f"📁 開始從目錄巡覽: {os.path.abspath(start_path)}")
    print(f"🚫 設定跳過資料夾: {', '.join(skip_folders)}\n" + "-"*50)

    file_count = 0

    # os.walk 會遞迴走訪每一個子目錄
    for root, dirs, files in os.walk(start_path):
        # 關鍵點：藉由原地 (in-place) 修改 dirs 陣列，os.walk 就會自動「跳過」這些資料夾
        dirs[:] = [d for d in dirs if d not in skip_folders]

        for file in files:
            # 組合出檔案的完整路徑
            file_path = os.path.join(root, file)
            print(file_path)
            file_count += 1

    print("-" * 50)
    print(f"✨ 巡覽完成！共找到 {file_count} 個檔案。")

if __name__ == "__main__":
    # 🎯 手動設定你想要跳過的資料夾名稱（大小寫需吻合）
    CUSTOM_SKIP = {
        ".git",
        "__pycache__",
        "node_modules",
        ".venv",
        "build",
        "dist"
    }

    # 從當前目錄開始印出
    list_all_files(start_path=".", skip_folders=CUSTOM_SKIP)