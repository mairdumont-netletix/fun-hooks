const hasProxy = typeof Proxy === 'function';

let baseObj = Object.getPrototypeOf({});

function assign(target) {
  return Array.prototype.slice.call(arguments, 1).reduce(function(target, obj) {
    if (obj) {
      Object.keys(obj).forEach(function(prop) {
        return target[prop] = obj[prop];
      });
    }
    return target;
  }, target);
}

function create(config) {
  let hooks = {};

  config = assign({
    useProxy: hasProxy
  }, config);

  function dispatch(arg1, arg2) {
    if (typeof arg1 === 'function') {
      return hookFn.call(null, 'sync', arg1, arg2);
    } else if (typeof arg1 === 'string' && typeof arg2 === 'function') {
      return hookFn.apply(null, arguments);
    } else if (typeof arg1 === 'object') {
      return hookObj.apply(null, arguments);
    }
  }

  function hookObj(obj, props, objName) {
    let walk = true;
    if (typeof props === 'undefined') {
      props = Object.getOwnPropertyNames(obj);
      walk = false;
    }
    let objHooks = {};
    let doNotHook = [
      'constructor'
    ];
    do {
      props = props.filter(function(prop) {
        return typeof obj[prop] === 'function' && !doNotHook.includes(prop) && !prop.match(/^_/);
      });
      props.forEach(function(prop) {
        let parts = prop.split(':');
        let name = parts[0];
        let type = parts[1] || 'sync';
        if (!objHooks[name]) {
          let fn = obj[name];
          objHooks[name] = obj[name] = hookFn(type, fn);
        }
      });
      obj = Object.getPrototypeOf(obj);
    } while(walk && obj !== baseObj);
    if (objName) {
      hooks[objName] = objHooks;
    }
    return objHooks;
  }

  function hookFn(type, fn, name) {
    if (fn.__funHook) {
      if (fn.__funHook === type) {
        if (name) {
          hooks[name] = fn;
        }
        return fn;
      } else {
        throw 'attempting to wrap func with different hook types';
      }
    }
    let hookFn;
    let before = [];
    before.type = 'before';
    let after = [];
    after.type = 'after';
    let beforeFn = add.bind(before);
    let afterFn = add.bind(after);
    let ext = {
      __funHook: type,
      before: beforeFn,
      after: afterFn,
      getHooks: getHooks,
      removeAll: removeAll,
      fn: fn
    };
    let handlers = {
      get: function(target, prop) {
        return ext[prop] || Reflect.get.apply(Reflect, arguments);
      }
    };

    function generateTrap() {
      function chainHooks(hooks, name, code) {
        for (let i = hooks.length; i-- > 0;) {
          if (i === 0 && !(type === 'async' && name ==='a')) {
            code = name + '[' + i + '].hook.apply(h,[' + code +
              (name === 'b' ? '].concat(g))' : ',r])');
          } else {
            code = name + '[' + i + '].hook.bind(h,' + code + ')';
            if (!(type === 'async' && name === 'a' && i === 0)) {
              code = 'n(' + code + ',e)';
            }
          }
        }
        return code;
      }

      if (before.length || after.length) {
        let code;
        if (type === 'sync') {
          let beforeCode = 'r=t.apply(h,' + (before.length ? 'arguments' : 'g') + ')';
          let afterCode;
          if (after.length) {
            afterCode = chainHooks(after, 'a', 'n(function extract(s){r=s},e)');
          }
          if (before.length) {
            beforeCode = chainHooks(before, 'b', 'n(function extract(){' + beforeCode + ';' + afterCode + '},e)');
            afterCode = '';
          }
          code = [
            'var r,e={bail:function(a){r=a}}',
            beforeCode,
            afterCode,
            'return r'
          ].join(';');
        } else if (type === 'async') {
          code = 't.apply(h,' +
            (before.length ?
              'Array.prototype.slice.call(arguments)' :   // if we're wrapped in partial, extract arguments
              'g')                                        // otherwise, we can just use passed in arguments
            + '.concat(' + chainHooks(after, 'a', 'z?n(z,e):[]') + '))';
          if (before.length) {
            code = 'n(function partial(){' + code + '},e)';
          }
          code = [
            'var z',
            'typeof g[g.length-1]==="function"&&(z=g.pop().bind(null))',
            'var e={bail:z}',
            chainHooks(before, 'b', code)
          ].join(';');
        }
        handlers.apply = (new Function('b,a,n,t,h,g', code))
          .bind(null, before, after, Object.assign || assign);
      } else {
        delete handlers.apply;
      }
    }

    function getHooks(match) {
      let hooks = before.concat(after);
      if (typeof match === 'object') {
        hooks = hooks.filter(function (entry) {
          return Object.keys(match).every(function(prop) {
            return entry[prop] === match[prop];
          });
        });
      }
      return assign(
        hooks, {
          remove: function() {
            hooks.forEach(function (entry) {
              entry.remove();
            });
            return hookFn;
          }
        }
      );
    }

    function removeAll() {
      return getHooks().remove();
    }

    function add(hook, priority) {
      let entry = {
        hook: hook,
        type: this.type,
        priority: priority || 10,
        remove: function() {
          let index = this.indexOf(entry);
          if (index !== -1) {
            this.splice(index, 1);
            generateTrap();
          }
        }.bind(this)
      };
      this.push(entry);
      this.sort(function (a, b) {
        return b.priority - a.priority;
      });
      generateTrap();
      return hookFn;
    }

    if (config.useProxy) {
      hookFn = new Proxy(fn, handlers);
    } else {
      hookFn = function() {
        return handlers.apply ?
          handlers.apply(fn, this, Array.prototype.slice.call(arguments)) :
          fn.apply(this, arguments);
      };
      assign(hookFn, ext);
    }

    if (name) {
      hooks[name] = hookFn;
    }
    return hookFn;
  }

  dispatch.hooks = hooks;
  return dispatch;
}

module.exports = create;
