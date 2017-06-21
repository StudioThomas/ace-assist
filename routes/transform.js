const _ = require('lodash');
const Promise = require('bluebird');
const sharp = require('sharp');
const request = require('request');
const mime = require('mime');
// const cv = require('opencv');
// const usage = require('usage');
const Logger = require('../lib/logger');

const mimeTypes = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/jpeg',
};

let publicDir;

const log = new Logger();

/*

Usage:

q - quality
sh - sharpen
bl - blur
g - gravity [north|south|east|west|center|entropy|attention|face]
x,y,x2,y2 - crop coords
w - width [pixels (< 1: percent)]
h - height [pixels (< 1: percent)]
sm - scale mode [fit/contain|fill/cover]

Convert format eg. jpg -> png: [filename].jpg.png

*/

const transform = (streamOrPath, settings, mimeType, format, faces) => new Promise((resolve, reject) => {
  faces = faces || [];

  const image = sharp(streamOrPath);

  image.metadata()
    .then((metadata) => {
      const width = metadata.width;
      const height = metadata.height;

      try {
        if (settings.sh) {
          if (_.isArray(settings.sh)) {
            const args = settings.sh.map(arg => Number(arg));
            image.sharpen(...args);
          }
          if (_.isString(settings.sh)) {
            switch (settings.sh.toLowerCase()) {
              case 'kirpan':
                image.sharpen(1, 0.4, 0.6);
                break;
              case 'default':
                image.sharpen();
                break;
              default:
                if (Number(settings.sh) >= 0.5) {
                  image.sharpen(Number(settings.sh));
                }
                break;
            }
          }
        }

        if (settings.bl && Number(settings.bl) >= 0.3) {
          image.blur(Number(settings.bl));
        }

        if (settings.x && settings.y && settings.x2 && settings.y2) {
          settings.x = Number(settings.x);
          settings.y = Number(settings.y);
          settings.x2 = Number(settings.x2);
          settings.y2 = Number(settings.y2);

          if (settings.x <= 1) {
            settings.x = Math.round(width * settings.x);
          }
          if (settings.y <= 1) {
            settings.y = Math.round(height * settings.y);
          }
          if (settings.x2 <= 1) {
            settings.x2 = Math.round(width * settings.x2);
          }
          if (settings.y2 <= 1) {
            settings.y2 = Math.round(height * settings.y2);
          }

          image.extract({
            left: settings.x,
            top: settings.y,
            width: settings.x2 - settings.x,
            height: settings.y2 - settings.y,
          });
        }

        if (settings.w || settings.h) {
          if (settings.w && Number(settings.w) <= 1) {
            settings.w *= (width / 100);
          }

          if (settings.h && Number(settings.h) <= 1) {
            settings.h *= (height / 100);
          }

          const interpolator = settings.w > 300 || settings.h > 200 ? 'bicubic' : 'vertexSplitQuadraticBasisSpline';

          if (!(settings.sm && /fill|cover/i.test(settings.sm)) || settings.g) {
            image.max();
          }

          const newWidth = parseInt(settings.w, 10) || null;
          const newHeight = parseInt(settings.h, 10) || null;

          image.resize(newWidth, newHeight, {
            interpolator: sharp.interpolator[interpolator],
          });

          if (settings.w && settings.h && settings.g) {
            const g = settings.g.toLowerCase();

            if (/^(north|northeast|east|southeast|south|southwest|west|northwest|center|centre)$/.test(g)) {
              image.crop(sharp.gravity[g]);
            }
            if (/^(entropy|attention)$/.test(g)) {
              image.crop(sharp.strategy[g]);
            }
          }
        }

        if (format === 'png') {
          image.png();

        } else if (format === 'webp') {
          image.webp({
            quality: parseInt(settings.q || 100, 10),
          });

        } else {
          image.jpeg({
            quality: parseInt(settings.q || 100, 10),
            progressive: true,
          });
        }

        image.withMetadata();

      } catch (error) {
        return reject(error);
      }

      return image.toBuffer()
        .then(resolve)
        .catch(reject);
    })
    .catch(reject);
});

const handleTransform = (req, res) => {
  if (res.finished) {
    return;
  }

  const mode = req.params.fileName ? 'local' : 'proxy';

  let settings;
  let options;
  let useQuery;

  try {
    // Take settings from json string after ?
    settings = JSON.parse(Object.keys(req.query)[0]);

    useQuery = true;

    if (!_.isObject(settings)) {
      log.error(res, req.url, 'invalid settings');
      return;
    }
  } catch (error) {
    useQuery = false;

    if (req.params.options) {
      // Take settings from params
      options = req.params.options;
    }

    if (mode === 'proxy') {
      // Take settings from first part of params
      options = req.params[0].split('/')[0];
    }

    if (!options) {
      log.error(res, req.url, error);
      return;
    }
  }

  if (options) {
    settings = {};
    options = options.split(/,|;/);

    options = options.filter(option => /_|:/.test(option));

    if (options.length === 0) {
      log.error(res, req.url, 'invalid options');
      return;
    }

    options.forEach((option) => {
      option = option.split(/_|:/);

      const key = option[0].toLowerCase();
      const value = option.length > 2 ? option.slice(1) : option[1];

      if (settings[key] && _.isArray(settings[key])) {
        settings[key].push(value);
      } else if (settings[key]) {
        settings[key] = [settings[key], value];
      } else {
        settings[key] = value;
      }
    });
  }

  let file;
  let mimeType;
  let format;

  if (mode === 'local') {
    const slug = req.params.slug || settings.slug;
    const fileNameParts = req.params.fileName.split('.');
    const fileName = fileNameParts.length > 2 ? fileNameParts.slice(0, fileNameParts.length - 1).join('.') : req.params.fileName;

    file = [publicDir, slug, fileName].join('/');
    mimeType = mime.lookup(file);
    format = fileNameParts.slice(-1)[0].toLowerCase();

    settings.slug = slug;
  }

  if (mode === 'proxy') {
    if (useQuery) {
      file = req.params[0];
    } else {
      file = req.params[0].split('/').slice(1).join('/');

      const qs = req.originalUrl.split('?')[1];
      if (qs) {
        file = file + '?' + qs;
      }
    }

    mimeType = mime.lookup(req.params[0]);
    format = req.params[0].split('.').slice(-1)[0].toLowerCase();
  }

  const logPrefix = req.originalUrl + ' ' + JSON.stringify(settings);
  const logInfo = log.info.bind(null, null, logPrefix);
  const logError = log.error.bind(null, res, logPrefix);

  let t = process.hrtime();
  console.time(logPrefix);

  const sendResult = (buffer) => {
    if (res.finished) {
      return;
    }

    t = process.hrtime(t);
    t = (t[0] === 0 ? '' : t[0]) + (t[1] / 1000 / 1000).toFixed(2) + 'ms';

    // logInfo(t)
    console.timeEnd(logPrefix);

    res.set('Content-Type', mimeTypes[format]);
    res.set('Last-Modified', new Date(0).toUTCString());
    res.set('X-Time-Elapsed', t);

    res.status(200).send(buffer);

    buffer = null;

    // usage.lookup(process.pid, function(err, result) {
    //     console.log(result)
    // })

    global.gc();
  };

  if (mode === 'local') {
    if (settings.g !== undefined && settings.g.toLowerCase() === 'face') {
      cv.readImage(file, (error, mat) => {
        if (error) {
          return logError(error);
        }

        return mat.detectObject(cv.FACE_CASCADE, {}, (err, faces) => {
          transform(mat.toBuffer(), settings, mimeType, format, faces)
            .then(sendResult)
            .catch(logError);
        });
      });
    } else {
      transform(file, settings, mimeType, format)
        .then(sendResult)
        .catch(logError);
    }
  } else if (mode === 'proxy') {
    request({
      method: 'GET',
      url: 'http://' + file,
      encoding: null,
    }, (error, response, body) => {
      if (error) {
        logError(error);
        return;
      }

      transform(body, settings, mimeType, format)
        .then(sendResult)
        .catch(logError);
    });
  }
};

module.exports = (app) => {
  publicDir = app.get('publicDir');

  app.get('/proxy/transform/*', handleTransform);

  app.get('/transform/:slug/:options/:fileName', handleTransform);

  app.get('/transform/:slug/:fileName', handleTransform);

  app.get('/transform/:fileName', handleTransform);
};