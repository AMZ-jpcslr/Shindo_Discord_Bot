// Synthetic demonstration data. Uses live GSI tiles; does not connect to Discord.
const fs=require('node:fs')
const {createIntensityMapAttachment}=require('../build/intensity_map')
const {createDisasterMapAttachment,linesForTsunamiAreaName}=require('../build/disaster_map')
;(async()=>{
    const quake=await createIntensityMapAttachment({Body:{Earthquake:{Hypocenter:{Area:{Coordinate:'+35.4+140.1-10000/'}}},Intensity:{Observation:{Pref:[{Area:[{City:[{IntensityStation:[
        {Int:'4',latlon:{lat:35.6,lon:140.1}},
        {Int:'3',latlon:{lat:35.68,lon:139.75}},
        {Int:'2',latlon:{lat:35.45,lon:139.64}},
        {Int:'1',latlon:{lat:36.1,lon:140.1}},
    ]}]}]}]}}}})
    const lines=await linesForTsunamiAreaName('相模湾・三浦半島','#ffff00')
    if(!lines.length) throw Error('coastline missing')
    const tsunami=await createDisasterMapAttachment([], 'tsunami-demo.png',lines)
    fs.mkdirSync('sample-output',{recursive:true})
    fs.writeFileSync('sample-output/gsi-earthquake-demo.png',quake.attachment)
    fs.writeFileSync('sample-output/gsi-tsunami-demo.png',tsunami.attachment)
    console.log('Generated synthetic earthquake and tsunami demo images using live GSI tiles. Not actual warnings.')
})().catch(error=>{console.error(error);process.exitCode=1})
