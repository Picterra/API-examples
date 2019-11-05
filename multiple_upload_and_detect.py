# This script upload all the images in a given directory,
# then it launches prediction on all of them, using a 
# pre-existant custom detector, created on the Picterra
# platform. The resulting GeoJSON files are saved in the
# same folder where the images lives. 

import sys
import os
import time
import requests


def upload_and_commit(file_path, file_name):
    """Upload and process a raster"""
    api_key = "123456789"  # Get it on the platform
    server_url = "https://app.picterra.ch/public/api/v1"
    headers =  { 'X-Api-Key': api_key }
    url = server_url + "/rasters/upload/file/" # Endpoint to get remote upload URL
    r = requests.post(url, headers=headers, data={'name': file_name}) 
    response = r.json()
    upload_url = response["upload_url"]  # Save upload URL
    raster_id = response["raster_id"]    # Save raster identifier
    size = os.stat(file_path).st_size
    with open(file_path, 'rb') as f:
        data = f.read()
        f.close()
        headers = { 'Content-Length': str(size) }
        requests.put(upload_url, headers=headers, data=data)   # Upload raster
        headers =  { 'X-Api-Key': api_key }
        url = server_url + ("/rasters/%s/commit/" % raster_id) # Process raster
        r = requests.post(url, headers=headers)
        poll_interval = r.json()["poll_interval"]
        headers =  { 'X-Api-Key': api_key }
        url = server_url + ("/rasters/%s/" % raster_id)
        while True:  # Wait until the raster is processed
            time.sleep(poll_interval)
            r = requests.get(url, headers=headers)
            if r.json()["status"] == "ready":
                break
    print("Raster uploaded and processed, you can now detect on it")
    return raster_id

def detect(detector_id, raster_id):
    """Detect on a raster with a given detector"""
    server_url = "https://app.picterra.ch/public/api/v1"  # Picterra Public API server
    headers =  { 'X-Api-Key': "123456789" }  # Get it on the Picterra platform
    url = server_url + ("/detectors/%s/run/" % detector_id)
    r = requests.post(url, headers=headers, data={'raster_id': raster_id}) 
    response = r.json()  # Start prediction result
    result_id = response["result_id"]
    poll_interval = response["poll_interval"]  # Waiting interval
    url = server_url + ("/results/%s/" % result_id)
    while True:  # Wait until prediction is finished
        time.sleep(poll_interval)
        r = requests.get(url, headers=headers)  # Get prediction status
        if r.json()["ready"]:
            download_url = r.json()["result_url"]
            break
    print("Detection finished, results available at %s" % download_url)
    return download_url

if __name__ == "__main__":
    if (len(sys.argv) < 3):
        print("Usage: " + __file__ + " path/to/directory detector_name")
        sys.exit(2)
    directory = sys.argv[1]
    detector_name = sys.argv[2]
    raster_ids = list()
    rasters = [(f, os.path.join(directory, f)) for f in os.listdir(directory)]
    for (raster_name, raster_path) in rasters:
        raster_id = upload_and_commit(raster_path, raster_name)
        raster_ids.append(raster_id)
        r = requests.get(
            "https://app.picterra.ch/public/api/v1/detectors/",
            headers={ 'X-Api-Key': "123456789" })
        detector_id = list(d["id"] for d in r.json() if d['name'] == detector_name)[0]
        for raster_id in raster_ids:
            download_url = detect(detector_id, raster_id)
            if not download_url:
                print("Detection failed or timed out")
            else:
                r = requests.get(download_url)
                with open('%s.geojson' % raster_path, 'wb') as f:
                    f.write(r.content)
                    f.close()
    print("Finished")