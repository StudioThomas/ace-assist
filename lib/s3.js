const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const mime = require('mime');
const AWS = require('aws-sdk');

module.exports = class S3 {
  constructor(accessKeyId, secretAccessKey, bucket) {
    this.s3 = new AWS.S3({
      accessKeyId,
      secretAccessKey,
    });

    this.bucket = bucket;

    Promise.promisifyAll(Object.getPrototypeOf(this.s3));
  }

  async upload(file, key) {
    const stats = await fs.statAsync(file);

    const fileSize = stats.size;
    const mimeType = mime.getType(file);

    const uploadOptions = {
      Bucket: this.bucket,
      Key: key,
      Body: fs.createReadStream(file),
      ACL: 'public-read',
      StorageClass: 'REDUCED_REDUNDANCY',
      Metadata: {},
      Expires: new Date('2099-01-01'),
      CacheControl: 'max-age=31536000',
      ContentType: mimeType,
      ContentLength: fileSize,
    };

    const upload = this.s3.upload(uploadOptions);

    // upload.on('httpUploadProgress', (event) => {
    //   // console.log(event);
    // });

    await upload.promise();

    return {
      uploadOptions,
      location: {
        bucket: this.bucket,
        key,
      },
      original: {
        fileSize,
        mimeType,
      },
    };
  }

  getSignedUrl(key, fileName) {
    return this.s3.getSignedUrlAsync('getObject', {
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName}"`,
    });
  }

  getObject(key) {
    return this.s3.getObjectAsync({
      Bucket: this.bucket,
      Key: key,
    });
  }

  async deleteFiles(names, slug = '') {
    if (names.length === 0) {
      return [];
    }

    const promises = [];

    names.forEach((name) => {
      promises.push(this.s3.listObjectsAsync({
        Bucket: this.bucket,
        Prefix: `${slug}/${name}`,
      }));
    });

    const results = await Promise.all(promises);

    const Objects = [];

    results.forEach((result) => {
      result.Contents.forEach((object) => {
        Objects.push({
          Key: object.Key,
        });
      });
    });

    const result = await this.s3.deleteObjectsAsync({
      Bucket: this.bucket,
      Delete: {
        Objects,
      },
    });

    return result;
  }

};