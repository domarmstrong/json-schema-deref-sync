'use strict';

var _path2 = require('path');

var _path3 = _interopRequireDefault(_path2);

var _url = require('url');

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _clone = require('clone');

var _clone2 = _interopRequireDefault(_clone);

var _traverse = require('traverse');

var _traverse2 = _interopRequireDefault(_traverse);

var _dagMap = require('dag-map');

var _dagMap2 = _interopRequireDefault(_dagMap);

var _md = require('md5');

var _md2 = _interopRequireDefault(_md);

var _utils = require('./utils');

var utils = _interopRequireWildcard(_utils);

var _file = require('./loaders/file');

var _file2 = _interopRequireDefault(_file);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var defaults = {
  baseFolder: process.cwd()
};

var defaultKeys = Object.keys(defaults);

var cache = {};

var loaders = {
  file: _file2.default
};

/**
 * Returns the reference schema that refVal points to.
 * If the ref val points to a ref within a file, the file is loaded and fully derefed, before we get the
 * pointing property. Derefed files are cached.
 *
 * @param refVal
 * @param refType
 * @param parent
 * @param options
 * @param state
 * @private
 */
function getRefSchema(refVal, refType, parent, options, state) {
  if (refType && loaders[refType]) {
    var newVal = void 0;
    var oldBasePath = void 0;
    var loaderValue = void 0;
    var filePath = void 0;
    var fullRefFilePath = void 0;

    if (refType === 'file') {
      filePath = utils.getRefFilePath(refVal);
      fullRefFilePath = utils.isAbsolute(filePath) ? filePath : _path3.default.resolve(state.cwd, filePath);

      if (cache[fullRefFilePath]) {
        loaderValue = cache[fullRefFilePath];
      }
    }

    if (!loaderValue) {
      loaderValue = loaders[refType](refVal, options);
      if (loaderValue) {
        // adjust base folder if needed so that we can handle paths in nested folders
        if (refType === 'file') {
          var dirname = _path3.default.dirname(filePath);
          if (dirname === '.') {
            dirname = '';
          }

          if (dirname) {
            oldBasePath = state.cwd;
            var newBasePath = _path3.default.resolve(state.cwd, dirname);
            options.baseFolder = state.cwd = newBasePath;
          }
        }

        loaderValue = derefSchema(loaderValue, options, state);

        // reset
        if (oldBasePath) {
          options.baseFolder = state.cwd = oldBasePath;
        }
      }
    }

    if (loaderValue) {
      if (refType === 'file' && fullRefFilePath && !cache[fullRefFilePath]) {
        cache[fullRefFilePath] = loaderValue;
      }

      if (refVal.indexOf('#') >= 0) {
        var refPaths = refVal.split('#');
        var refPath = refPaths[1];
        var refNewVal = utils.getRefPathValue(loaderValue, refPath);
        if (refNewVal) {
          newVal = refNewVal;
        }
      } else {
        newVal = loaderValue;
      }
    }

    return newVal;
  } else if (refType === 'local') {
    return utils.getRefPathValue(parent, refVal);
  }
}

/**
 * Add to state history
 * @param {Object} state the state
 * @param {String} type ref type
 * @param {String} value ref value
 * @private
 */
function addToHistory(state, type, value) {
  var dest = void 0;

  if (type === 'file') {
    dest = utils.getRefFilePath(value);
  } else {
    if (value === '#') {
      return false;
    }
    dest = state.current.concat(':' + value);
  }

  if (dest) {
    dest = dest.toLowerCase();
    if (state.history.indexOf(dest) >= 0) {
      return false;
    }

    state.history.push(dest);
  }
  return true;
}

/**
 * Set the current into state
 * @param {Object} state the state
 * @param {String} type ref type
 * @param {String} value ref value
 * @private
 */
function setCurrent(state, type, value) {
  var dest = void 0;
  if (type === 'file') {
    dest = utils.getRefFilePath(value);
  }

  if (dest) {
    state.current = dest;
  }
}

/**
 * Check the schema for local circular refs using DAG
 * @param {Object} schema the schema
 * @return {Error|undefined} <code>Error</code> if circular ref, <code>undefined</code> otherwise if OK
 * @private
 */
function checkLocalCircular(schema) {
  var dag = new _dagMap2.default();
  var locals = (0, _traverse2.default)(schema).reduce(function (acc, node) {
    if (node && typeof node.$ref === 'string') {
      var refType = utils.getRefType(node);
      if (refType === 'local') {
        var value = utils.getRefValue(node);
        if (value) {
          var _path = this.path.join('/');
          acc.push({
            from: _path,
            to: value
          });
        }
      }
    }
    return acc;
  }, []);

  if (!locals || !locals.length) {
    return;
  }

  if (_lodash2.default.some(locals, function (elem) {
    return elem.to === '#';
  })) {
    return new Error('Circular self reference');
  }

  var check = _lodash2.default.find(locals, function (elem) {
    var from = elem.from.concat('/');
    var dest = elem.to.substring(2).concat('/');
    try {
      dag.addEdge(from, dest);
    } catch (e) {
      return elem;
    }

    if (from.indexOf(dest) === 0) {
      return elem;
    }
  });

  if (check) {
    return new Error('Circular self reference from ' + check.from + ' to ' + check.to);
  }
}

/**
 * Derefs $ref types in a schema
 * @param schema
 * @param options
 * @param state
 * @param type
 * @private
 */
function derefSchema(schema, options, state) {
  var check = checkLocalCircular(schema);
  if (check instanceof Error) {
    return check;
  }

  if (state.circular) {
    return new Error('circular references found: ' + state.circularRefs.toString());
  } else if (state.error) {
    return state.error;
  }

  return (0, _traverse2.default)(schema).forEach(function (node) {
    if (node && typeof node.$ref === 'string') {
      var refType = utils.getRefType(node);
      var refVal = utils.getRefValue(node);

      var addOk = addToHistory(state, refType, refVal);
      if (!addOk) {
        state.circular = true;
        state.circularRefs.push(refVal);
        state.error = new Error('circular references found: ' + state.circularRefs.toString());
        this.update(node, true);
        return;
      } else {
        setCurrent(state, refType, refVal);
        var newValue = getRefSchema(refVal, refType, schema, options, state);
        state.history.pop();
        if (newValue === undefined) {
          if (state.missing.indexOf(refVal) === -1) {
            state.missing.push(refVal);
          }
          if (options.failOnMissing) {
            state.error = new Error('Missing $ref: ' + refVal);
          }
          this.update(node, options.failOnMissing);
          return;
        } else {
          this.update(newValue);
          if (state.missing.indexOf(refVal) !== -1) {
            state.missing.splice(state.missing.indexOf(refVal), 1);
          }
        }
      }
    }
  });
}

/**
 * Derefs <code>$ref</code>'s in JSON Schema to actual resolved values. Supports local, and file refs.
 * @param {Object} schema - The JSON schema
 * @param {Object} options - options
 * @param {String} options.baseFolder - the base folder to get relative path files from. Default is <code>process.cwd()</code>
 * @param {Boolean} options.failOnMissing - By default missing / unresolved refs will be left as is with their ref value intact.
 *                                        If set to <code>true</code> we will error out on first missing ref that we cannot
 *                                        resolve. Default: <code>false</code>.
 * @return {Object|Error} the deref schema oran instance of <code>Error</code> if error.
 */
function deref(schema, options) {
  options = _lodash2.default.defaults(options, defaults);

  var bf = options.baseFolder;
  var cwd = bf;
  if (!utils.isAbsolute(bf)) {
    cwd = _path3.default.resolve(process.cwd(), bf);
  }

  var state = {
    graph: new _dagMap2.default(),
    circular: false,
    circularRefs: [],
    cwd: cwd,
    missing: [],
    history: []
  };

  try {
    var str = JSON.stringify(schema);
    state.current = (0, _md2.default)(str);
  } catch (e) {
    return e;
  }

  var baseSchema = (0, _clone2.default)(schema);

  cache = {};

  var ret = derefSchema(baseSchema, options, state);
  if (ret instanceof Error === false && state.error) {
    return state.error;
  }
  return ret;
}

module.exports = deref;