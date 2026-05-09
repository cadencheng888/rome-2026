import rasterio
import matplotlib.pyplot as plt

path = "dataset_v4/california/0.tif"

with rasterio.open(path) as src:
    arr = src.read()

rgb = arr[[2,1,0]].transpose(1,2,0)
rgb = rgb / rgb.max()

ndvi = arr[4]
suit = arr[6]

fig, ax = plt.subplots(1,3, figsize=(15,5))

ax[0].imshow(rgb)
ax[0].set_title("RGB")

ax[1].imshow(ndvi)
ax[1].set_title("NDVI")

ax[2].imshow(suit)
ax[2].set_title("Suitability")

plt.show()