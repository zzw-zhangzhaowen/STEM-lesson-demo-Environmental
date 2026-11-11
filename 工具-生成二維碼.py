# -*- coding: utf-8 -*-
"""
生成展示用二维码卡片（白底 + 二维码 + 網址）。

用法：
    python 工具-生成二維碼.py
    python 工具-生成二維碼.py https://example.com/自訂網址/
    python 工具-生成二維碼.py --plain            # 只要純二維碼，不要卡片

輸出：二維碼.png（卡片）、二維碼-純.png
依賴：pip install "qrcode[pil]"
"""
from __future__ import annotations

import sys
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont
from qrcode.constants import ERROR_CORRECT_H

HERE = Path(__file__).parent
DEFAULT_URL = "https://zzw-zhangzhaowen.github.io/STEM-lesson-demo-Environmental/"
TITLE = "地球媽媽拯救大作戰"
SUBTITLE = "× 小科數字人 · 手機掃碼即玩"
TIP = "手機：相機／掃碼 App 對準即可"

FONT_CANDIDATES = [
    r"C:/Windows/Fonts/msjh.ttc",      # 微軟正黑（繁中，優先）
    r"C:/Windows/Fonts/msyh.ttc",      # 微軟雅黑
    r"C:/Windows/Fonts/simhei.ttf",
]


def load_font(size: int):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def make_qr(url: str) -> Image.Image:
    """容錯等級 H：即使印小了或被遮一角，仍能掃出。"""
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=12, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    return qr.make_image(fill_color="#1f3b34", back_color="white").convert("RGB")


def make_card(qr_img: Image.Image, url: str) -> Image.Image:
    W, H = 900, 1180
    card = Image.new("RGB", (W, H), "#ffffff")
    draw = ImageDraw.Draw(card)

    draw.rectangle([0, 0, W, 14], fill="#3f8f6d")          # 頂部色帶

    f_title, f_sub = load_font(46), load_font(28)
    f_url, f_tip = load_font(21), load_font(24)

    for text, font, fill, y in (
        (TITLE, f_title, "#1f3b34", 62),
        (SUBTITLE, f_sub, "#5b7a6e", 132),
    ):
        w = draw.textlength(text, font=font)
        draw.text(((W - w) / 2, y), text, font=font, fill=fill)

    size = 560
    qx, qy = (W - size) // 2, 220
    draw.rounded_rectangle(
        [qx - 22, qy - 22, qx + size + 22, qy + size + 22],
        radius=26, outline="#cfe3d8", width=4, fill="#ffffff",
    )
    card.paste(qr_img.resize((size, size), Image.NEAREST), (qx, qy))

    # 網址換行顯示，避免超出畫布
    pretty = url.replace("https://", "").replace("http://", "").rstrip("/") + "/"
    cut = pretty.find("/")
    lines = [pretty[:cut], pretty[cut:]] if cut > 0 else [pretty]
    for i, line in enumerate(lines):
        w = draw.textlength(line, font=f_url)
        draw.text(((W - w) / 2, qy + size + 60 + i * 30), line, font=f_url,
                  fill="#1f3b34" if i == 0 else "#3f8f6d")

    w = draw.textlength(TIP, font=f_tip)
    draw.text(((W - w) / 2, H - 78), TIP, font=f_tip, fill="#7a8f85")
    return card


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--plain"]
    url = args[0] if args else DEFAULT_URL
    if not url.startswith(("http://", "https://")):
        raise SystemExit(f"[中止] 網址要以 http(s):// 開頭：{url}")

    qr_img = make_qr(url)
    plain = HERE / "二維碼-純.png"
    qr_img.save(plain)
    print(f"純二維碼：{plain}  {qr_img.size[0]}x{qr_img.size[1]}")

    if "--plain" not in sys.argv:
        card = make_card(qr_img, url)
        out = HERE / "二維碼.png"
        card.save(out)
        print(f"卡片：{out}  {card.size[0]}x{card.size[1]}")

    print(f"內容：{url}")


if __name__ == "__main__":
    main()
