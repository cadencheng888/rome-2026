import rasterio

path = "dataset/california/patch_0.tif"

with rasterio.open(path) as src:
    print(src.shape)
    print(src.count)
    arr = src.read()

print(arr.min(), arr.max())