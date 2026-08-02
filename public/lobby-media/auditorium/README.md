# 影厅后墙图片

把自定义后墙壁画放在此目录，然后在 `../config.json` 中填写：

```json
"images": {
  "auditoriumRear": "/lobby-media/auditorium/rear-mural.webp"
}
```

推荐使用约 `16:5` 的横向图片。程序会完整显示图片并自动留边，不会裁切；将路径设为空字符串会恢复内置星空壁画。
