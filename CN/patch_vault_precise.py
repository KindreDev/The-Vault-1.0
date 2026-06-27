"""
The Vault 精确汉化补丁 v2.0
只替换显示字符串，不替换图标名称和代码逻辑
"""
import os
import shutil
import sys

sys.stdout.reconfigure(encoding='utf-8')

DIST = r"I:\TheVault\_internal\frontend\dist\assets"
BAK = os.path.join(DIST, "backup_en")

# ── 确保备份存在 ──
if not os.path.isdir(BAK):
    os.makedirs(BAK)
    for f in os.listdir(DIST):
        if f.endswith('.js'):
            shutil.copy2(os.path.join(DIST, f), os.path.join(BAK, f))
    print("备份已创建")

counts = {}

def patch_file(fname, replacements):
    """对单个文件应用精确替换"""
    fpath = os.path.join(DIST, fname)
    if not os.path.exists(fpath):
        print(f"  跳过 {fname} (不存在)")
        return 0
    
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    orig = content
    n = 0
    for old, new in replacements:
        # 只替换双引号包裹的
        c = content.count(f'"{old}"')
        content = content.replace(f'"{old}"', f'"{new}"')
        n += c
    
    if content != orig:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        counts[fname] = n
        print(f"  ✓ {fname}: {n} 处替换")
    else:
        print(f"  - {fname}: 无变更")
    return n


print("=" * 50)
print("The Vault 精确汉化补丁 v2.0")
print("=" * 50)

# ═══════════════════════════════════════════════
# 1. index-B6M3vpx-.js - 导航 + 侧边栏 + 设备状态
# ═══════════════════════════════════════════════
index_rep = [
    # 导航标签
    ('Dashboard', '仪表盘'),
    ('Galleries', '图库'),
    ('Photos', '图片'),
    ('Videos', '视频'),
    ('Creators', '创作者'),
    ('Multi-panel', '多面板'),
    ('Device Control', '设备控制'),
    ('Stats', '统计'),
    ('Quests', '任务'),
    ('Hall of Fame', '名人堂'),
    ('Card Collection', '卡牌收藏'),
    ('Tag Manager', '标签管理'),
    ('Duplicates', '重复检测'),
    ('Task Queue', '任务队列'),
    ('Console', '控制台'),
    ('Help', '帮助'),
    ('Settings', '设置'),
    # 侧边栏分类标题
    ('Goon', '沉迷'),
    ('Collect', '收集'),
    ('Tools', '工具'),
    # 设备状态
    ('Device · Live', '设备 · 运行中'),
    ('Device · Idle', '设备 · 空闲'),
    ('Device · Off', '设备 · 离线'),
    ('Connecting…', '连接中…'),
    # 个人资料
    ('View profile', '查看个人资料'),
    ('Loading...', '加载中...'),
    # XP显示
    (' XP', ' 经验'),
    # 包通知
    ('Quest reward', '任务奖励'),
    ('Booster', '补充包'),
    ('Premium', '高级'),
    ('Pack', '包'),
    ('Packs', '包'),
    ('Added to your collection', '已添加到你的收藏'),
]
patch_file('index-B6M3vpx-.js', index_rep)

# ═══════════════════════════════════════════════
# 2. Collection-qVdhx9Cy.js - 卡牌页面
# ═══════════════════════════════════════════════
collection_rep = [
    # 稀有度标签 (label:"...")
    ('Common', '普通'),
    ('Uncommon', '不凡'),
    ('Rare', '稀有'),
    ('Epic', '史诗'),
    ('Legendary', '传说'),
    ('Relic', '遗物'),
    ('Celestial', '天界'),
    # 卡牌类型显示
    ('Unknown', '未知'),
    ('✦ Collab Variant', '✦ 合作异画'),
    ('Collab Gallery', '合作图库'),
    ('Collab', '合作'),
    ('Gallery', '图库'),
    ('Creator', '创作者'),
    ('★ Goon Card', '★ 沉迷卡牌'),
    ('Variant', '异画'),
    ('Photo', '照片'),
    # 月份
    ('Jan', '1月'), ('Feb', '2月'), ('Mar', '3月'), ('Apr', '4月'),
    ('May', '5月'), ('Jun', '6月'), ('Jul', '7月'), ('Aug', '8月'),
    ('Sep', '9月'), ('Oct', '10月'), ('Nov', '11月'), ('Dec', '12月'),
]
patch_file('Collection-qVdhx9Cy.js', collection_rep)

# ═══════════════════════════════════════════════
# 3. pages-Du7elENO.js - 设置/统计/任务等页面
# ═══════════════════════════════════════════════
pages_rep = [
    ('Settings', '设置'),
    ('Stats', '统计'),
    ('Quests', '任务'),
    ('XP History', '经验历史'),
    ('Scan Log', '扫描日志'),
    ('XP', '经验'),
]
patch_file('pages-Du7elENO.js', pages_rep)

# ═══════════════════════════════════════════════
# 4. Profile-JyS6xk3s.js - 个人资料页
# ═══════════════════════════════════════════════
profile_rep = [
    (' XP', ' 经验'),
    ('Loading...', '加载中...'),
]
patch_file('Profile-JyS6xk3s.js', profile_rep)

# ═══════════════════════════════════════════════
# 5. Help-BfVKUSXU.js - 帮助页面
# ═══════════════════════════════════════════════
help_rep = [
    ('Overview', '概述'),
    ('Navigation', '导航'),
    ('Goon', '沉迷'),
    ('Collect', '收集'),
    ('Tools', '工具'),
    ('Help', '帮助'),
]
patch_file('Help-BfVKUSXU.js', help_rep)

# ═══════════════════════════════════════════════
# 6. 其他页面文件
# ═══════════════════════════════════════════════
for fname, reps in [
    ('Dashboard-CuRc6dvr.js', [
        ('XP', '经验'),
        ('Loading...', '加载中...'),
    ]),
    ('GalleryList-CpPN0Nnm.js', [
        ('Galleries', '图库'),
        ('Gallery', '图库'),
        ('Loading...', '加载中...'),
    ]),
    ('GalleryView-BG-TuNud.js', [
        ('Gallery', '图库'),
        ('Loading...', '加载中...'),
        ('XP', '经验'),
    ]),
    ('CreatorList-ChTZUypO.js', [
        ('Creators', '创作者'),
        ('Creator', '创作者'),
        ('Loading...', '加载中...'),
    ]),
    ('CreatorProfile-CfPmiug0.js', [
        ('Creator', '创作者'),
        ('Loading...', '加载中...'),
        ('XP', '经验'),
    ]),
    ('ImageList-U2OVxz14.js', [
        ('Gallery', '图库'),
        ('Photos', '图片'),
        ('Loading...', '加载中...'),
    ]),
    ('DeviceControl-B4mmUfDk.js', [
        ('Device', '设备'),
        ('Loading...', '加载中...'),
    ]),
    ('HallOfFame-jUnYs5xA.js', [
        ('Hall of Fame', '名人堂'),
        ('Loading...', '加载中...'),
    ]),
    ('MultiPanel-DlKotzPl.js', [
        ('Multi-panel', '多面板'),
        ('Loading...', '加载中...'),
    ]),
    ('PlaylistView-D6tHy66u.js', [
        ('Playlist', '播放列表'),
        ('Loading...', '加载中...'),
    ]),
    ('Duplicates-DZr61474.js', [
        ('Duplicates', '重复检测'),
        ('Loading...', '加载中...'),
    ]),
    ('TagManager-CFgzKASR.js', [
        ('Tag Manager', '标签管理'),
        ('Loading...', '加载中...'),
    ]),
    ('Console-B15cwQIC.js', [
        ('Console', '控制台'),
        ('Loading...', '加载中...'),
    ]),
    ('ViewerPanel-CAeI9_TN.js', [
        ('Loading...', '加载中...'),
        ('XP', '经验'),
    ]),
    ('DeviceControls-mdd5h_2B.js', [
        ('Device', '设备'),
        ('Loading...', '加载中...'),
    ]),
    ('SortDropdown-OQ-K5-tS.js', [
        ('Sort', '排序'),
    ]),
    ('TagFilterInput-DAgYzTod.js', [
        ('Filter', '筛选'),
        ('Search', '搜索'),
    ]),
]:
    patch_file(fname, reps)

print(f"\n{'=' * 50}")
print(f"完成! 修改了 {len(counts)} 个文件")
for f, n in sorted(counts.items()):
    print(f"  {f}: {n} 处替换")
print(f"\n请重启 The Vault 以查看汉化效果。")
print(f"如需恢复，请从 {BAK} 复制备份文件。")
