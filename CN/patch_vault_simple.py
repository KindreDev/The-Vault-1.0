"""
The Vault 汉化补丁脚本（简化版）
"""
import os
import sys
import shutil

sys.stdout.reconfigure(encoding='utf-8')

DIST_DIR = r"I:\TheVault\_internal\frontend\dist\assets"
BACKUP_DIR = r"I:\TheVault\_internal\frontend\dist\assets\backup_en"

TRANSLATIONS = {
    # 导航栏
    "Dashboard": "仪表盘",
    "Galleries": "图库",
    "Photos": "图片",
    "Videos": "视频",
    "Creators": "创作者",
    "Multi-panel": "多面板",
    "Device Control": "设备控制",
    "Stats": "统计",
    "Quests": "任务",
    "Hall of Fame": "名人堂",
    "Card Collection": "卡牌收藏",
    "Tag Manager": "标签管理",
    "Duplicates": "重复检测",
    "Task Queue": "任务队列",
    "Console": "控制台",
    "Help": "帮助",
    "Settings": "设置",
    # 侧边栏分类
    "Goon": "沉迷",
    "Collect": "收集",
    "Tools": "工具",
    # 设备状态
    "Device \u00b7 Live": "设备 \u00b7 运行中",
    "Device \u00b7 Idle": "设备 \u00b7 空闲",
    "Device \u00b7 Off": "设备 \u00b7 离线",
    "Connecting\u2026": "连接中\u2026",
    "View profile": "查看个人资料",
    "Loading...": "加载中...",
    # 稀有度
    "Common": "普通",
    "Uncommon": "不凡",
    "Rare": "稀有",
    "Epic": "史诗",
    "Legendary": "传说",
    "Relic": "遗物",
    "Celestial": "天界",
    # 卡牌类型
    "Unknown": "未知",
    "\u2666 Collab Variant": "\u2666 合作异画",
    "Collab Gallery": "合作图库",
    "Collab": "合作",
    "Gallery": "图库",
    "Creator": "创作者",
    "\u2605 Goon Card": "\u2605 沉迷卡牌",
    "Variant": "异画",
    "Photo": "照片",
    # 包通知
    "Quest reward": "任务奖励",
    "Booster": "补充包",
    "Premium": "高级",
    "Added to your collection": "已添加到你的收藏",
}

def main():
    print("=" * 50)
    print("The Vault Chinese Patch")
    print("=" * 50)
    
    os.makedirs(BACKUP_DIR, exist_ok=True)
    print(f"Backup dir: {BACKUP_DIR}")
    
    files = sorted([f for f in os.listdir(DIST_DIR) if f.endswith('.js')])
    print(f"JS files found: {len(files)}")
    
    total = 0
    for fname in files:
        fpath = os.path.join(DIST_DIR, fname)
        bpath = os.path.join(BACKUP_DIR, fname)
        
        if not os.path.exists(bpath):
            shutil.copy2(fpath, bpath)
        
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original = content
        count = 0
        
        for eng, chn in sorted(TRANSLATIONS.items(), key=lambda x: -len(x[0])):
            # Replace with double quotes
            content = content.replace(f'"{eng}"', f'"{chn}"')
            # Replace with single quotes  
            content = content.replace(f"'{eng}'", f"'{chn}'")
        
        if content != original:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(content)
            total += 1
        else:
            print(f"  No changes in {fname}")
    
    print(f"\nFiles modified: {total}")
    print("Done!")

if __name__ == "__main__":
    main()
