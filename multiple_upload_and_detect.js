/*  This script upload all the images in a given directory,
    then it launches prediction on all of them, using a 
    pre-existant custom detector, created on the Picterra
    platform. The resulting GeoJSON files are saved in the
    same folder where the images lives. 
*/ 

const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const Headers = fetch.Headers
const sleep = ms => new Promise(resolve=> setTimeout(resolve,ms))
const apiKey = "1234"
const apiServer = 'http://localhost:8080/public/api/v1'

if (process.argv.length < 4) {
    console.log("Usage: " + __filename + " path/to/directory detector_name");
    process.exit(-1);
}
const directory = process.argv[2]
const detectorName = process.argv[3]
try {
    let promises = []
    const images = fs.readdirSync(directory)
    for (let i=0; i<images.length; i++) {
        promises.push(
            upload(path.join(directory, images[i]), images[i]))
    }
    Promise.all(promises).then(
        rasterIds => {
            promises = []
            rasterIds.forEach(rasterId => promises.push( commit(rasterId)))
            Promise.all(promises).then ( () => {
                getDetectorId(detectorName).then(
                    detectorId => {
                        promises = []
                        for (let i=0; i<rasterIds.length; i++) {
                            promises.push(
                                detect(rasterIds[i], images[i], detectorId, directory))
                        }
                        Promise.all(promises).then (
                            () => console.log('Finished')
                        )
                    }
                )
            }).catch(err => console.error(err) )
        }
    ).catch(err => console.error(err) )
} catch(err) { console.error(err) }


async function upload(filePath, fileName) {
    let options, response, data, file, size
    options = {
        method: 'POST',
        headers: new Headers({
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey
        }),
        body: JSON.stringify({ 'name': fileName })
    }
    response = await fetch(`${apiServer}/rasters/upload/file/`, options)
    data = await response.json()
    const uploadUrl = data.upload_url
    const rasterId = data.raster_id
    file = await fs.createReadStream(filePath)
    size = fs.statSync(filePath)["size"]
    options = { 
        method: 'PUT',
        body: file, 
        headers: new Headers({
            'Content-Type': 'multipart/form-data',
            'Content-Length': size
        })
    }
    response = await fetch(uploadUrl, options)
    console.log("Upload finished for " + fileName)
    return rasterId
}

async function commit(rasterId) {
    options = {
        method: 'POST',
        headers: new Headers({ 'X-Api-Key': apiKey })
    }
    response = await fetch(`${apiServer}/rasters/${rasterId}/commit/`, options) 
    data = await response.json()
    const pollInterval = data.poll_interval
    options = { headers: new Headers({ 'X-Api-Key': apiKey})}
    isReady = false
    const timeout = Date.now() + (5 * 60 * 1000)  // 5 minutes timeout
    do {
        await sleep(pollInterval * 1000 / 20)
        response = await fetch(`${apiServer}/rasters/${rasterId}/`, options)
        data = await response.json()
        isReady = (data.status == "ready")
    }
    while (!isReady && (Date.now() < timeout))
    console.log("Commit " + (isReady ? 'finished' : 'failed'))
    return isReady
}
 
async function getDetectorId(detectorName) {
    response = await fetch(
        `${apiServer}/detectors/`, 
        { headers: new Headers({'X-Api-Key': apiKey}) }
    )
    detectorsList = await response.json()
    return detectorsList.find(detectorObject => detectorObject["name"] == detectorName)["id"]
}


async function detect(rasterId, rasterName, detectorId, directory) {
    let options, response, data
    options = {
        method: 'POST',
        headers: new Headers({
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey
        }),
        body: JSON.stringify({
            'raster_id': rasterId
        })
    }
    response = await fetch(`${apiServer}/detectors/${detectorId}/run/`, options) 
    if (response.status != 201) {
        throw new Error(response.body)
    }
    data = await response.json()
    const pollInterval = data.poll_interval
    const resultId = data.result_id
    options = { headers: new Headers({ 'X-Api-Key': apiKey})}
    isReady = false
    const timeout = Date.now() + (10 * 60 * 1000)  // 10 minutes timeout
    do {
        await sleep(pollInterval * 1000)
        response = await fetch(`${apiServer}/results/${resultId}/`, options)
        data = await response.json()
        if (response.status != 200 || data.status == "failed")
            throw new Error(response.status)
        isReady = data.ready
    }
    while (!isReady && (Date.now() < timeout))
    if (isReady) {
        console.log(`Detection on ${rasterName} finished`)
        const geoJson = await fetch(data.result_url)
        const geojsonPath = `${directory}/${rasterName}.geojson`
        const fileStream = fs.createWriteStream(geojsonPath);
        await new Promise((resolve, reject) => {
            geoJson.body.pipe(fileStream)
            geoJson.body.on("error", err => reject(err))
            fileStream.on("finish", () => resolve())
        });
        return true
    } else { throw new Error("Detection timed out") }
}
