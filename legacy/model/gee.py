import ee

ee.Initialize(project='fire-help-495802')
print(ee.String('Earth Engine works').getInfo())