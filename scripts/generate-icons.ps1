# Reproduce the existing SVG M mark as PNG icons, with an opaque orange background.
Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path $PSScriptRoot '../dist/icons'
[System.IO.Directory]::CreateDirectory($iconRoot) | Out-Null
foreach ($size in @(180,192,512)) {
  $bitmap = [System.Drawing.Bitmap]::new($size,$size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#FF6600'))
  $graphics.ScaleTransform($size/40.0,$size/40.0)
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black,5)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $points = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(9,29),[System.Drawing.PointF]::new(9,11),[System.Drawing.PointF]::new(20,23),[System.Drawing.PointF]::new(31,11),[System.Drawing.PointF]::new(31,29))
  $graphics.DrawLines($pen,$points)
  $filename = if($size -eq 180){'apple-touch-icon.png'}else{"icon-$size.png"}
  $bitmap.Save((Join-Path $iconRoot $filename),[System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose();$graphics.Dispose();$bitmap.Dispose()
}
# Android adaptive icons must keep the entire mark in the central safe circle.
$bitmap = [System.Drawing.Bitmap]::new(512,512)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#FF6600'))
$graphics.TranslateTransform(76.8,76.8)
$graphics.ScaleTransform(8.96,8.96)
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black,5)
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawLines($pen,$points)
$bitmap.Save((Join-Path $iconRoot 'icon-maskable-512.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$pen.Dispose();$graphics.Dispose();$bitmap.Dispose()
