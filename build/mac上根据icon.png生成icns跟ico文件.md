最稳的做法是：先准备一张 **1024×1024 或 2048×2048 的正方形 PNG**，背景透明，文件名假设为：

```bash
build/icon.png
```

然后分别生成：

* `build/icon.icns` 给 mac
* `build/icon.ico` 给 Windows

---

## 一、先准备源图

要求：

* 正方形
* 建议 `1024x1024` 以上
* PNG
* 尽量透明背景
* 图标主体不要贴边，留一点安全边距

比如：

```bash
build/icon.png
```

---

## 二、在 mac 上生成 `build/icon.icns`

mac 自带 `iconutil`，不用装额外工具。

### 1）创建 iconset 目录

```bash
mkdir -p build/icon.iconset
```

### 2）生成各尺寸 PNG

用 mac 自带的 `sips`：

```bash
sips -z 16 16     build/icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     build/icon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   build/icon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_512x512.png
cp build/icon.png build/icon.iconset/icon_512x512@2x.png
```

如果你的源图不是 1024×1024，最后一行也可以改成：

```bash
sips -z 1024 1024 build/icon.png --out build/icon.iconset/icon_512x512@2x.png
```

### 3）打包成 `.icns`

```bash
iconutil -c icns build/icon.iconset -o build/icon.icns
```

生成后就是：

```bash
build/icon.icns
```

---

## 三、在 mac 上生成 `build/icon.ico`

最方便的是用 ImageMagick。

### 1）安装 ImageMagick

```bash
brew install imagemagick
```

### 2）生成 `.ico`

```bash
magick build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

生成后就是：

```bash
build/icon.ico
```

---

## 四、推荐你直接用这一整套命令

假设你已经有 `build/icon.png`，那直接执行：

```bash
mkdir -p build/icon.iconset

sips -z 16 16     build/icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     build/icon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   build/icon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_512x512.png
cp build/icon.png build/icon.iconset/icon_512x512@2x.png

iconutil -c icns build/icon.iconset -o build/icon.icns
magick build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

---

## 五、生成后放哪里

最终目录建议是：

```bash
build/icon.png
build/icon.icns
build/icon.ico
```

然后在 `package.json` 里这样配：

```json
{
  "build": {
    "mac": {
      "icon": "build/icon.icns"
    },
    "win": {
      "icon": "build/icon.ico"
    }
  }
}
```

---

## 六、常见坑

### 1. `iconutil` 报错

通常是 `icon.iconset` 里的文件名不对，必须是这些标准名字：

* `icon_16x16.png`
* `icon_16x16@2x.png`
* `icon_32x32.png`
* `icon_32x32@2x.png`
* `icon_128x128.png`
* `icon_128x128@2x.png`
* `icon_256x256.png`
* `icon_256x256@2x.png`
* `icon_512x512.png`
* `icon_512x512@2x.png`

### 2. 图标发糊

通常是源图分辨率不够，或者主体太小。源图尽量用矢量导出成 1024+ PNG。

### 3. Windows 图标不更新

Windows 和 electron-builder 都会缓存，改完后最好删除旧产物重新打包。

### 4. mac 开发模式还显示 Electron

这是 dev 启动 bundle 的问题，不是 `.icns` 文件本身的问题。`.icns` 主要解决打包产物。

---

## 七、最省事的方法

如果你只是想尽快做出来：

1. 准备 `build/icon.png`
2. 跑上面的命令
3. 得到 `build/icon.icns` 和 `build/icon.ico`

如果你愿意，我可以直接给你一份 `scripts/make-icons.sh`，你放到项目里一键生成。
