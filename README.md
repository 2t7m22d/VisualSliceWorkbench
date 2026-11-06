# VisualSliceWorkspace

## 使用方法
打开 [main/index.html](main/index.html) 即可使用，无需安装其它依赖
将XY./XZ.或.bfslice文件拖入即可绘图，[main/example](main/example) 文件夹中提供了示例文件
网页右上角包含使用教程。

## .bfslice文件
使用plot_auto_bfslice.f90文件切片即可得到，使用方法与此前的plot文件一致
```
gfortran plot_auto_bfslice.f90 -o [name]
```
编译使用即可
