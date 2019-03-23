(function() {
    var isArray = createIsArray();
    var modulesList = createModuleList(); //mapa z modułami (oraz zależnościami)
    var scriptLoader = null; //obiekt którym ładujemy pliki (tworzony po podaiu mapy z konfiguracją)

    freezProperty(window, "require", requireGlobal);
    freezProperty(window, "define", defineGlobal);
    freezProperty(requireGlobal, "runnerBox", createRunnerBox(requireGlobal));
    freezProperty(requireGlobal.runnerBox, "runElement", requireGlobal.runnerBox.runElement);
    freezProperty(requireGlobal.runnerBox, "whenRun", requireGlobal.runnerBox.whenRun);
    freezProperty(requireGlobal, "defined", isLoad);

    runStarter(configGlobal, requireGlobal);

    function isLoad(path) {
        if (scriptLoader === null) {
            return false;
        } else {
            return scriptLoader.isLoad(path);
        }
    }

    function freezProperty(obj, prop, value) {
        try {
            defProp(false);
        } catch (e1) {
            try {
                defProp(true);
            } catch (e2) {
                obj[prop] = value;
            }
        }

        function defProp(isConfigurable) {
            Object.defineProperty(obj, prop, {
                get: function() {
                    return value;
                },
                set: function( /*val*/ ) {
                },
                configurable: isConfigurable
            });
        }
    }

    function configGlobal(conf) {
        if (scriptLoader === null) {
            scriptLoader = createScriptLoader(conf.paths);
        }
    }

    function requireGlobal(deps, callback) {
        modulesList.requireModules(deps, callback);
    }

    function defineGlobal(deps, moduleDefine, thirdArgs) {
        if (arguments.length === 1) {
            // define(function() {
            modulesList.define([], deps);

        } else if (arguments.length === 2) {
            if (typeof(deps) === "string" && typeof(moduleDefine) === "function") {
                // define("modulename", function() {
                modulesList.define([], moduleDefine);
            } else {
                // define(["mods ..."], function() {
                modulesList.define(deps, moduleDefine);
            }
        } else if (arguments.length === 3) {
            // define("modulename", ["mods ..."], function(){
            modulesList.define(moduleDefine, thirdArgs);
        } else {
            throw new Error('Malformed define', arguments);
        }
    }

    function createModuleList() {
        var isFirstRequire = false;
        var list = {}; //lista z modułami
        var waitingDefine = []; //to co wpadło za pomocą funkcji define, wpada na tąże listę

        return {

            requireModulesWithModuleBase: requireModulesWithModuleBase,
            requireModules: requireModules,
            requireOne: requireOne,
            define: defineOne
        };

        function getBasePath(path, callback) {
            var chunks = path.split("/");
            if (chunks.length < 2) {
                return;
            }

            chunks.pop();
            callback(chunks.join("/"));
        }

        function combinePath(baseDir, dirModule) {
            var chunk1 = baseDir.split("/");
            var chunk2 = dirModule.split("/");

            if (chunk2.length > 0) {
                if (chunk2[0] === ".") {
                    var outChunks = [];
                    forEach(chunk1, function(item) {
                        outChunks.push(item);
                    });

                    forEach(chunk2, function(item) {
                        if (item === ".") {
                            //nic nie rób z tym członem
                        } else {
                            outChunks.push(item);
                        }
                    });

                    var outPath = outChunks.join("/");
                    if (outPath.indexOf(baseDir) === 0) {
                        return outPath;
                    }
                } else {
                    return dirModule;
                }
            }
        }

        function requireModulesWithModuleBase(moduleName, deps, callback) {
            getBasePath(moduleName, function(basePathModule) {
                var newDeps = [];
                for (var i = 0; i < deps.length; i++) {
                    var newDepItem = combinePath(basePathModule, deps[i]);
                    if (typeof(newDepItem) === "string" && newDepItem !== "") {
                        newDeps.push(newDepItem);
                    }
                }
                requireModules(newDeps, callback);
            });
        }

        //zwraca listę modułów - pod warunkiem że wszystkei zostały poprawnie zainicjowane
        function requireModules(deps, callback) {
            var isExec = false;
            var retValue = {};

            forEach(deps, function(depsName) {
                if (depsName in retValue) {
                    // skip
                } else {
                    retValue[depsName] = {
                        isInit: false,
                        value: null
                    };

                    requireOne(depsName, function(moduleValue) {
                        var moduleInfo = retValue[depsName];
                        if (moduleInfo.isInit === false) {
                            moduleInfo.isInit = true;
                            moduleInfo.value = moduleValue;
                            refreshStatus();
                        }
                    });
                }
            });

            refreshStatus();

            function refreshStatus() {
                if (isExec === false) {
                    var arrReturn = [];
                    for (var i = 0; i < deps.length; i++) {
                        var modName = deps[i];
                        if (retValue[modName].isInit === true) {
                            arrReturn.push(retValue[modName].value);
                        } else {
                            return;
                        }
                    }
                    isExec = true;

                    if (typeof(callback) === "function") {
                        callback.apply(null, arrReturn);
                    }
                }
            }
        }

        function requireOne(path, callback) {
            isFirstRequire = true;
            var fullPath = scriptLoader.resolvePath(path, "js", true);
            if (fullPath in list) {
                //ok
            } else {
                list[fullPath] = createModule(path);
                scriptLoader.load(fullPath, function() {
                    definePushToModule(fullPath);
                });
            }

            list[fullPath].get(callback);
        }

        function definePushToModule(actualLoadingPath) {
            if (actualLoadingPath in list) {
                while (waitingDefine.length > 0) {
                    var item = waitingDefine.pop();
                    if (isCircleDeps(actualLoadingPath, item.deps)) {
                        throw new Error('circular dependency');
                    } else {
                        list[actualLoadingPath].setDefine(item.deps, item.define);
                    }
                }
                list[actualLoadingPath].closeDefine();
            }
        }

        function defineOne(deps, moduleDefine) {
            var currentScript = getCurrentScript();
            if (isFirstRequire !== true) {
                return;
            }
            if (currentScript !== null) {
                var srcCurrent = currentScript.getAttribute("src");
                if (srcCurrent in list) {
                    list[srcCurrent].setDefine(deps, moduleDefine);
                    return;
                }
            }

            var actualLoading = scriptLoader.getActialLoading();
            //przypadek starszych IE
            if (isNoEmptyString(actualLoading)) {
                if (actualLoading in list) {
                    list[actualLoading].setDefine(deps, moduleDefine);
                }
                return;
            }

            waitingDefine.push({
                deps: deps,
                define: moduleDefine
            });
        }

        function isCircleDeps(path, depsList) {
            var isScan = {};
            var waiting = [];

            appendArray(waiting, depsList);

            while (waiting.length > 0) {
                process();
            }

            return (path in isScan);

            function appendArray(target, newElements) {
                forEach(newElements, function(item) {
                    target.push(item);
                });
            }

            function process() {
                var depsItem = waiting.shift();
                if (depsItem in isScan) {
                    //pomijam, zależnośc była skanowana
                } else {
                    isScan[depsItem] = true;

                    if (depsItem in list) {
                        var newDeps = list[depsItem].getDeps();
                        appendArray(waiting, newDeps);
                    } else {
                        //brak wiadomych obecnie zależności
                    }
                }
            }
        }
    }

    function createModule(nameModule) {
        var isInit = false;
        var isClose = false;

        var depsNamesSave = null;
        var evalValue = null;

        var waiting = queryCallbackAsync();

        return {
            isDefine: isDefine,
            setDefine: setDefine,
            getDeps: getDeps,
            get: get,
            closeDefine: closeDefine
        };

        function closeDefine() {
            isClose = true;

            if (isInit === false) {
                isInit = true;
                waiting.exec([undefined]);
            }
        }

        function isDefine() {
            return isInit;
        }

        function get(callback) {
            waiting.add(callback);
        }

        function setDefine(depsName, defineModuleFunction) {
            if (isClose === true) {
                return;
            }

            if (isInit === false) {
                isInit = true;
                depsNamesSave = depsName;

                setTimeout(function() {
                    modulesList.requireModulesWithModuleBase(nameModule, depsName, function() {
                        var depsValue = Array.prototype.slice.call(arguments, 0);

                        try {
                            evalValue = defineModuleFunction.apply(null, depsValue);
                        } catch (errEval) {
                            return;
                        }

                        waiting.exec([evalValue]);
                    });
                }, 0);
            }
        }

        function getDeps() {
            if (isInit === true) {
                return depsNamesSave;
            } else {
                return [];
            }
        }
    }

    function createScriptLoader(configPath) {
        var loadingScriprs = {};

        return {
            load: load,
            getActialLoading: getActialLoading,
            resolvePath: resolvePath,
            isLoad: isLoadLocal,
            isSpecified: isSpecified
        };

        function isSpecified(path) {
            var fullPath = resolvePath(path, "js", false);
            if (isNoEmptyString(fullPath)) {
                if (fullPath in loadingScriprs) {
                    return true;
                }
            }
            return false;
        }

        function resolvePath(path, extension) {
            if (path.length > 0 && path[0] === ".") {
                return;
            }

            if (path.substr(0, 8) === "https://") {
                return path;
            } else if (path.substr(0, 7) === "http://") {
                return path;
            } else if (path.substr(0, 2) === "//") {
                return path;
            } else {
                for (var alias in configPath) {
                    if (path.indexOf(alias + "/") === 0) {
                        var newPath = path.replace(alias, configPath[alias]);
                        if (path !== newPath) {
                            if (isNoEmptyString(extension)) {
                                return newPath + "." + extension;
                            } else {
                                return newPath;
                            }
                        } else {
                            return;
                        }
                    }
                }
            }
        }

        function getActialLoading() {
            for (var prop in loadingScriprs) {
                if (loadingScriprs[prop].script.readyState === 'interactive') {
                    return prop;
                }
            }
            return null;
        }

        function isLoadLocal(path) {
            var fullPath = resolvePath(path, "js", true);

            if (isNoEmptyString(fullPath)) {
                if (fullPath in loadingScriprs) {
                    return loadingScriprs[fullPath].query.isExec();
                }
            }
            return false;
        }

        function load(fullPath, callback) {
            if (isNoEmptyString(fullPath)) {
                if (fullPath in loadingScriprs) {
                    //ok
                } else {
                    var script = loadScript(fullPath, function() {
                        loadingScriprs[fullPath].query.exec([]);
                    });

                    loadingScriprs[fullPath] = {
                        script: script,
                        query: queryCallbackSync()
                    };
                    //ze względu na kesze IE.
                    appendToDom(script);
                }
                loadingScriprs[fullPath].query.add(callback);
            } else {
                //... nie złądowano ...
            }
        }

        function appendToDom(script) {
            document.getElementsByTagName('head')[0].appendChild(script);
        }

        function loadScript(path, callback) {
            var isExec = false;
            var script = document.createElement('script');

            script.type = 'text/javascript';
            script.src = path;
            script.onload = runCallback;
            script.async = true;
            script.defer = true;
            script.onreadystatechange = onreadystatechange;

            return script;

            function onreadystatechange() {
                if (script.readyState === 'loaded' || script.readyState === 'complete') {
                    runCallback();
                }
            }

            function runCallback() {
                if (isExec === true) {
                    return;
                }
                isExec = true;
                callback(script);
            }
        }
    }

    function forEach(list, callback) {
        for (var i = 0; i < list.length; i++) {
            callback(list[i]);
        }
    }

    function isNoEmptyString(value) {
        return typeof(value) === "string" && value !== "";
    }

    //kolejka żądań opróżniana jest synchronicznie
    function queryCallbackSync() {
        return queryCallback(true);
    }

    //kolejka żądań oprózniana jest asynchronicznie
    function queryCallbackAsync() {
        return queryCallback(false);
    }

    function queryCallback(isSync) {
        var isExec = false;
        var waitList = [];
        var argsEmit = null;

        return {
            exec: exec,
            add: add,
            isExec: isExecFn
        };

        function isExecFn() {
            return isExec;
        }

        function exec(args) {
            if (isArray(args)) {
                if (isExec === false) {
                    isExec = true;
                    argsEmit = args;
                    refreshState();
                }
            }
        }

        function refreshState() {
            if (isExec === true) {
                while (waitList.length > 0) {
                    if (isSync === true) {
                        runCallbackSync(waitList.shift());
                    } else {
                        runCallbackAsync(waitList.shift());
                    }
                }
            }
        }

        function runCallbackAsync(functionItem) {
            setTimeout(function() {
                functionItem.apply(null, argsEmit);
            }, 0);
        }

        function runCallbackSync(functionItem) {
            functionItem.apply(null, argsEmit);
        }

        function add(call) {
            if (typeof(call) === "function") {
                waitList.push(call);
                refreshState();
            }
        }
    }

    function createIsArray() {
        if (typeof(Array.isArray) === "function") {
            return function(arg) {
                return Array.isArray(arg);
            };
        } else {
            return function(arg) {
                return Object.prototype.toString.call(arg) === '[object Array]';
            };
        }
    }

    function createRunnerBox(require) {
        var attrNameToRun = "data-run-module";
        var propStorageName = 'runnerBoxElementProp' + ((new Date()).getTime());
        var requestAnimationFrame = createRequestAnimationFrame();

        return {
            runElement: runElement,
            whenRun: whenRun
        };

        //TODO
        //https://developer.mozilla.org/pl/docs/Web/JavaScript/Reference/Global_Objects/WeakMap
        function getObject(item) {
            if (propStorageName in item) {
                //ok
            } else {
                item[propStorageName] = createMapper();
            }
            return item[propStorageName];
        }

        function createEventHard() {
            var isReady = false;
            var callback = [];

            return {
                on: on,
                exec: exec
            };

            function refresh() {
                if (isReady === true) {
                    while (callback.length > 0) {
                        runCallback(callback.shift());
                    }
                }
            }

            function runCallback(callback) {
                setTimeout(callback, 0);
            }

            function exec() {
                if (isReady === false) {
                    isReady = true;
                    refresh();
                } else {
                    refresh();
                }
            }

            function on(newCallback) {
                callback.push(newCallback);
                refresh();
            }
        }

        function createMapper() {
            var isRunFlag = false;
            var value = null;
            var event = createEventHard();

            return {
                onReady: onReady,
                setAsRun: setAsRun,
                setValue: setValue,
                isRun: isRun
            };

            function isRun() {
                return isRunFlag;
            }

            function onReady(callback) {
                event.on(function() {
                    callback(value);
                });
            }

            function setAsRun() {
                if (isRunFlag === false) {
                    isRunFlag = true;
                }
            }

            function setValue(newValue) {
                if (isRunFlag === true) {
                    value = newValue;
                    event.exec();
                }
            }
        }

        function runElement(domElementToRun) {
            var list = findFromDocument(domElementToRun);

            forEachRun(list, function(item) {
                var widgetName = getModuleName(item);
                var part = widgetName.split(".");

                if (part.length !== 2) {
                    throw new Error("irregulari contents of the attribute data-run-module: " + widgetName);
                }

                var moduleName = part[0];
                var moduleMethod = part[1];

                require([moduleName], function(module) {
                    requestAnimationFrame(function() {
                        var message;

                        if (hasAttributeToRun(item) && getObject(item).isRun() === false) {
                            getObject(item).setAsRun();
                            if (module && typeof(module[moduleMethod]) === "function") {
                                item.setAttribute(attrNameToRun + "-isrun", "1");

                                var outdatedApi = module[moduleMethod](item, function(apiModule) {
                                    getObject(item).setValue(apiModule);
                                });

                                if (typeof(outdatedApi) !== "undefined") {
                                    getObject(item).setValue(outdatedApi);
                                }
                            } else {
                                message = "No function \"" + moduleMethod + "\" in module : " + moduleName;
                                item.setAttribute(attrNameToRun + "-isrun", message);
                                throw new Error(message);
                            }
                        }
                    });
                });
            });

            function getModuleName(item) {
                var widgetName = item.getAttribute(attrNameToRun);
                if (typeof(widgetName) === "string" && widgetName !== "") {
                    return widgetName;
                }
                return null;
            }
        }

        function forEachRun(list, callback) {
            var copy = [];
            for (var i = 0; i < list.length; i++) {
                copy.push(list[i]);
            }
            for (var k = 0; k < copy.length; k++) {
                runCallback(copy[k]);
            }

            function runCallback(item) {
                setTimeout(function() {
                    callback(item);
                }, 0);
            }
        }

        function findFromDocument(elementSearch) {
            if (elementSearch === document || testParent(elementSearch, isClosestParentIsRunItemTest) === true) {
                if (isDataRunModule(elementSearch)) {
                    if (getObject(elementSearch).isRun() === true) {
                        return findChild();
                    } else {
                        return [elementSearch];
                    }
                } else {
                    return findChild();
                }
            } else {
                return [];
            }

            function findChild() {
                var listWidgetsRun = elementFindAll(elementSearch, "*[" + attrNameToRun + "]", attrNameToRun);
                var result = [];
                var item = null;

                for (var i = 0; i < listWidgetsRun.length; i++) {
                    item = listWidgetsRun[i];
                    if (testParent(item, isDirectChildTestItem) === true) { //isDirectChild(item) === true) {
                        result.push(item);
                    }
                }

                return result;
            }

            function isClosestParentIsRunItemTest(element) {
                if (hasAttributeToRun(element)) {
                    if (getObject(element).isRun() === true) {
                        return true;
                    } else {
                        return false;
                    }
                }

                if (element.tagName === "HTML") {
                    return true;
                }
            }

            function isDirectChildTestItem(element) {
                if (element === elementSearch) {
                    return true;
                }
                if (hasAttributeToRun(element)) {
                    return false;
                }
            }

            function isDataRunModule(domElement) {
                if (typeof(domElement.getAttribute) !== "function") {
                    return false;
                }
                return isNoEmptyString(domElement.getAttribute("data-run-module"));
            }

            function testParent(elementTest, fnTest) {
                var countRecursion = 0;
                return inner(elementTest.parentNode);

                function inner(element) {
                    countRecursion++;
                    if (countRecursion > 200) {
                        recursionError();
                        return false;
                    }

                    var valueTest = fnTest(element);
                    if (valueTest === true || valueTest === false) {
                        return valueTest;
                    }

                    if (element.parentNode) {
                        return inner(element.parentNode);
                    }

                    return false;
                }

                function recursionError() {
                    var error = new Error("Too much recursion");

                    setTimeout(function() {
                        throw error;
                    }, 0);
                }
            }
        }

        function elementFindAll(element, selector) {
            if (element === document) {
                element = document.documentElement;
            }

            return convertToArray(element.querySelectorAll(selector));

            function convertToArray(list) {

                var out = [];

                for (var i = 0; i < list.length; i++) {
                    out.push(list[i]);
                }

                return out;
            }
        }

        function whenRun(element, callback) {
            if (hasAttributeToRun(element)) {
                getObject(element).onReady(callback);
            }
        }

        function hasAttributeToRun(element) {
            var value = element.getAttribute(attrNameToRun);
            return (typeof(value) === "string" && value !== "");
        }


        function createRequestAnimationFrame() {
            if (typeof(window.requestAnimationFrame) === "function") {
                return window.requestAnimationFrame;
            }

            var vendors = ['ms', 'moz', 'webkit', 'o'];
            var candidate = null;
            for (var x = 0; x < vendors.length; ++x) {
                candidate = window[vendors[x] + 'RequestAnimationFrame'];
                if (typeof(candidate) === "function") {
                    return candidate;
                }
            }
            return function(callback) {
                callback();
            };
        }
    }

    //amd module starter
    function runStarter(configGlobal, require) {
        var currentScript = getCurrentScript();
        if (currentScript !== null) {
            if (runRequire(currentScript) === true) {
                return;
            }
        }

        var scriptList = document.getElementsByTagName('script');
        for (var i = 0; i < scriptList.length; i++) {
            if (runRequire(scriptList[i]) === true) {
                return;
            }
        }

        function runRequire(node) {
            var mapAmd = mapParser(node);
            if (mapAmd !== null) {
                runRequireMap(configGlobal, mapAmd, getListPreLoad(), getTimeoutStart());
                return true;
            } else {
                return false;
            }

            function getListPreLoad() {
                var list = node.getAttribute("data-amd-preload");
                if (isNoEmptyString(list)) {
                    return list.split(",");
                } else {
                    return [];
                }
            }

            function getTimeoutStart() {
                var timeoutStart = node.getAttribute("data-timeout-start");
                if (timeoutStart > 0) {
                    return timeoutStart;
                } else {
                    return 2000;
                }
            }
        }

        function runRequireMap(configGlobal, pathConfig, listPreload, timeoutStart) {
            configGlobal({
                paths: pathConfig
            });

            addEvent(window, "load", function() {
                runMain();

                //dodatkowe zabezpieczenie
                setTimeout(function() {
                    runMain();
                }, 10000);
            });


            if (documentIsComplete()) {
                runMain();
            }

            if (documentIsLoaded()) {
                runTimeout();
            }

            addEvent(document, 'DOMContentLoaded', function() {
                runTimeout();

                //http://www.w3schools.com/jsref/event_onpageshow.asp
                addEvent(document.getElementsByTagName('body')[0], 'pageshow', function() {
                    runMain();
                });
            });

            addEvent(document, 'readystatechange', function() {
                if (documentIsComplete() || documentIsLoaded()) {
                    runTimeout();
                }
            });

            function runTimeout() {
                setTimeout(function() {
                    runMain();
                }, timeoutStart);
            }

            function runMain() {
                setTimeout(function() {
                    if (listPreload.length > 0) {
                        require(listPreload, function() {});
                    }
                    require.runnerBox.runElement(document);
                }, 0);
            }

            function documentIsComplete() {
                return document.readyState === "complete";
            }

            function documentIsLoaded() {
                return document.readyState === "loaded";
            }
        }

        function mapParser(node) {
            var data = node.getAttribute("data-static-amd-map");
            if (typeof(data) === "string") {
                if (data === "") {
                    return {};
                } else {
                    //dalsze parsowanie
                }
            } else {
                return null;
            }

            return JSON.parse(data);
        }

        function addEvent(element, event, callback) {
            element.addEventListener(event, callback, false);
        }
    }

    //https://developer.mozilla.org/pl/docs/Web/API/Document/currentScript
    function getCurrentScript() {
        if (document.currentScript && typeof(document.currentScript.getAttribute) === "function") {
            return document.currentScript;
        }
        return null;
    }
}());
