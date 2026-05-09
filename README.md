<p align="center">
  <img src="/rescorched logo.png" alt="re:scorched Logo" width="40%" height=auto>
  <br>
  Michelle Dong, Caden Cheng, Julia Jin, David Wan
</p>

## About Our Project & Significance
re:scorched is a web-based prescribed-fire planning simulation that allows users to safely model controlled burns using live satellite imagery, directly in their browser. Every year, large fires devastate communities across the globe, claiming lives and causing billions of dollars in damage. re:scorched addresses this escalating crisis by simulating precise fire behavior based on specific coordinates and dates chosen by the user.

Once a location is inputted, the platform visualizes exactly how fire will spread across that specific terrain under realistic, user-defined weather conditions. The engine is designed for users to be able to compare the differences between different situations: users can run multiple scenarios on the same map to directly compare the devastating spread of an unmanaged wildfire against the safe, contained spread of a prescribed burn. Going a step further, our predictive model analyzes the landscape to recommend the optimal zones for controlled burns, maximizing fuel reduction while minimizing future threat. This tool is purposefully built for government officials, fire departments, and land management agencies for data driven fire mitigation. 

Eleven locations that are tied to previous disasters over the past decade are used to run the simulation:
  - Pacific Palisades, CA (2025)
  - Paradise, CA (2018 Camp Fire)
  - Lahaina, Maui (2023)
  - Gatlinburg, TN (2016)
  - Fort McMurray, Canada (2016)
  - Knysna, South Africa (2017)
  - Mati, Greece (2018)
  - Blue Mountains, Australia (2019–20 Black Summer)
  - Amazon Basin, Brazil
  - Sumatra, Indonesia
  
Each location comes with multiple bands that come from real satellite and government data such as NDVI, NDMI, slope, elevation, etc. to simulate real conditions as closely as possible. The simulation is grounded in real fire physics and real regulatory framework. The fire spread is calculated using the Rothermel 1972 fire spread equations along with Albini 1976 extensions, yielding rate of spread, Byram flame length, and fireline intensity in real units (chains per hour, feet, and BTU per foot per second). Before any ignition, the simulator validates its conditions so it follows the same conditions as what an actual controlled fire must be in, ensuring temperature, humidity, wind, fuel moisture, elevation, and ventilation index all check against the published ranges that real burn bosses use. If the conditions fail, then an actual wildfire runs, and not a controlled one. 

The tech stack of our project includes:
  1. React 19 / Typescript - for the UI framework and language
  2. Vite - dev server
  3. Three.js - the 3D rendering engine
  4. React Three Fiber - React bindings and helper components for Three.js
  5. globe.gl - the spinning 3D Earth on the home page with clickable locations
  6. geotiff - in browser parsing of multi-band satellite files
  7. Google Earth Engine - where we got the satellite and government data
  8. rasterio - reads/writes GeoTIFFS
  9. PyTorch + segmentation_models_pytorch - U-Net burn suitability model

## Our Inspiration & What Makes us Unique
What makes us unique compared to other projects that try to visualize and model wildfires and controlled burns is that our project remembers that at the end of the day, climate conservation is for the sake of the people. The reason controlled fires are started is to mitigate larger, uncontrolled wildfires, which at the end of the day makes everybody safer.

Our group understands this immensely. First off, the data and tools we use are purely open source. We utilize Google Earth Engine, Globe.gl, NDVI/NDMI datasets, and population census data to build a simulator visualizer that lets anybody understand that controlled fires are beneficial. This bridges the knowledge gap between everyday citizens and experts. People who may not have experience with ecosystems or data science can use our visualizer to better understand how controlled fires help prevent devastating wildfires.

### WILDFIRE VS CONTROLLED BURN 

Our leverage of open source tools solves a very real societal challenge: the fact that knowledge is often gated by experience or access to tools. In depth research and visualization is often performed by experts with access to powerful computational tools. However, our simulator is not only lightweight, but also very intuitive. Because of this, anyone with a device can utilize re:scorched to explore the science and strategy behind controlled burns, and how they are beneficial to reducing wildfire risk.

## Project Creation Process 
We wanted our model to be as scalable and generalizable as possible, so we built a diverse training dataset composed of regions where controlled burning is commonly beneficial. These regions included much of the west coast of the United States, the Northern Australian savannas, and Indonesian drylands. Our goal was to expose the model to a wide range of vegetation types, climates, terrains, and fire conditions.

Using Google Earth Engine, we retrieved a total of 10 environmental features (including RGB imagery) from datasets such as Sentinel-2 SR Harmonized. From Sentinel-2, we incorporated Near Infrared (NIR) and Short-Wave Infrared (SWIR) bands. Near Infrared (NIR) data is strongly reflected by healthy vegetation, allowing us to estimate vegetation density and the amount of potentially burnable biomass within a region. Short-Wave Infrared (SWIR) data is highly sensitive to moisture, dryness, and burn scars, making it useful for identifying dry vegetation and previously burned areas.

From these spectral bands, we derived two additional features:

  - NDVI (Normalized Difference Vegetation Index), used to estimate vegetation density and biomass
  - NDMI (Normalized Difference Moisture Index), used to estimate vegetation moisture and fuel dryness

We also utilized the ERA5-Land dataset to gather weather-related features such as temperature and wind speed in order to approximate suitable prescribed-burn conditions. Weather is critical for controlled burns, as strong or unstable winds can significantly increase the risk of an uncontrolled wildfire.

Finally, we incorporated terrain information from the SRTM DEM dataset to compute slope, or terrain steepness. Slope is an important operational and safety factor in real-world controlled burn planning, since steep terrain can dramatically increase fire spread rates and reduce firefighter accessibility and controllability.

Because, evidently, we are not wildfire experts, our model does not necessarily predict where controlled burns should be with 100% accuracy as it currently just approximates a “suitability” score based on vegetation density, fuel dryness, slope, wind conditions, and temperature. The output should therefore be interpreted as an ecological burn-potential and dry-fuel suitability estimate rather than a fully accurate operational recommendation.

We exported the training data as 11-band GeoTIFFs containing:
  - 10 input feature channels
  - 1 target/output channel

Training was performed on 128×128 pixel patches at a spatial resolution of 100 meters per pixel, meaning each pixel represents a 100m × 100m area on the ground.

For the model architecture, we used a U-Net segmentation network due to its computational efficiency, strong spatial localization capabilities, and ability to capture multi-scale contextual information. The model was trained using a supervised regression and segmentation approach.

For inference, we developed a pipeline capable of processing large GeoTIFF regions using a sliding-window approach. The system feeds overlapping 128×128 patches into the model and merges predictions using a cosine blending window to eliminate visible tile boundaries and reduce edge artifacts between neighboring predictions. 

## Future Expansions & Applications
Our long-term goal is to expand the system into a globally scalable prescribed-burn suitability platform capable of adapting to many different ecosystems and fire regimes around the world.

One future direction we plan to take is significantly increasing the scale and diversity of the training dataset. While, due to time constraint, we had to limit our training dataset, we plan to incorporate additional ecosystems such as:

  - Mediterranean shrublands in Southern Europe
  - Boreal forests in Canada and Siberia
  - African savannas
  - Amazonian dry-transition regions
  - Southeastern United States pine ecosystems
  - Grasslands and shrublands across South America

By exposing the model to more climates, vegetation structures, terrain types, and seasonal fire behaviors, we hope to improve both generalization and robustness across global environments. We don’t expect this “large model” to perform predictions perfectly so the next step would be to fine-tune it for specific regions. 

We also plan to incorporate real-time environmental data streams across the globe. This includes dynamically updating:

  - wind speed and direction
  - humidity
  - temperature
  - drought conditions
  - recent precipitation
  - vegetation moisture
Integrating live weather data would allow the model to move beyond static ecological suitability estimation.

Ultimately, our goal is not to automate wildfire decision-making, but to build a scalable AI-assisted analysis tool that can help researchers, ecologists, and fire-management experts better understand control-fire techniques, and serve as a public awareness tool.

