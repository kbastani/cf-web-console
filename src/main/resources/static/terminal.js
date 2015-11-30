/*
 Copyright 2011 Google Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.

 Author: Eric Bidelman (ericbidelman@chromium.org)
 */

var util = util || {};
util.toArray = function (list) {
    return Array.prototype.slice.call(list || [], 0);
};

// Cross-browser impl to get document's height.
util.getDocHeight = function () {
    var d = document;
    return Math.max(
        Math.max(d.body.scrollHeight, d.documentElement.scrollHeight),
        Math.max(d.body.offsetHeight, d.documentElement.offsetHeight),
        Math.max(d.body.clientHeight, d.documentElement.clientHeight)
    );
};


// TODO(ericbidelman): add fallback to html5 audio.
function Sound(opt_loop) {
    var self_ = this;
    var context_ = null;
    var source_ = null;
    var loop_ = opt_loop || false;

    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    if (window.AudioContext) {
        context_ = new window.AudioContext();
    }

    this.load = function (url, mixToMono, opt_callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
            if (context_) {
                context_.decodeAudioData(this.response, function (audioBuffer) {
                    self_.sample = audioBuffer;
                    opt_callback && opt_callback();
                }, function (e) {
                    console.log(e);
                });
            }
        };
        xhr.send();
    };

    this.play = function () {
        if (context_) {
            source_ = context_.createBufferSource();
            source_.buffer = self_.sample;
            source_.looping = loop_;
            source_.connect(context_.destination);
            source_.noteOn(0);
        }
    };

    this.stop = function () {
        if (source_) {
            source_.noteOff(0);
            source_.disconnect(0);
        }
    };
}

var Terminal = Terminal || function (containerId) {
        window.URL = window.URL || window.webkitURL;
        window.requestFileSystem = window.requestFileSystem ||
            window.webkitRequestFileSystem;

        const VERSION_ = '1.0.0';
        const CMDS_ = [
            '3d', 'cat', 'cd', 'cp', 'clear', 'date', 'help', 'install', 'ls', 'mkdir',
            'mv', 'open', 'pwd', 'rm', 'rmdir', 'theme', 'version', 'who', 'wget', "cf"
        ];
        const THEMES_ = ['default', 'cream'];

        var fs_ = null;
        var cwd_ = null;
        var history_ = [];
        var histpos_ = 0;
        var histtemp_ = 0;

        var timer_ = null;
        var magicWord_ = null;

        var fsn_ = null;
        var is3D_ = false;

        // Fire worker to return recursive snapshot of current FS tree.
        var worker_ = new Worker('worker.js');
        worker_.onmessage = function (e) {
            var data = e.data;
            if (data.entries) {
                fsn_.contentWindow.postMessage({cmd: 'build', data: data.entries},
                    window.location.origin);
            }
            if (data.msg) {
                output('<div>' + data.msg + '</div>');
            }
        };
        worker_.onerror = function (e) {
            console.log(e)
        };

        // Create terminal and cache DOM nodes;
        var container_ = document.getElementById(containerId);
        container_.insertAdjacentHTML('beforeEnd',
            ['<output></output>',
                '<div id="input-line" class="input-line">',
                '<div class="prompt">$&gt;</div><div><input class="cmdline" autofocus /></div>',
                '</div>'].join(''));
        var cmdLine_ = container_.querySelector('#input-line .cmdline');
        var output_ = container_.querySelector('output');
        var interlace_ = document.querySelector('.interlace');
        var bell_ = new Sound(false);
        bell_.load('beep.mp3', false);

        // Hackery to resize the interlace background image as the container grows.
        output_.addEventListener('DOMSubtreeModified', function (e) {
            var docHeight = util.getDocHeight();
            document.documentElement.style.height = docHeight + 'px';
            //document.body.style.background = '-webkit-radial-gradient(center ' + (Math.round(docHeight / 2)) + 'px, contain, rgba(0,75,0,0.8), black) center center no-repeat, black';
            interlace_.style.height = docHeight + 'px';
            setTimeout(function () { // Need this wrapped in a setTimeout. Chrome is jupming to top :(
                //window.scrollTo(0, docHeight);
                cmdLine_.scrollIntoView();
            }, 0);
            //window.scrollTo(0, docHeight);
        }, false);

        output_.addEventListener('click', function (e) {
            var el = e.target;
            if (el.classList.contains('file') || el.classList.contains('folder')) {
                cmdLine_.value += ' ' + el.textContent;
            }
        }, false);

        window.addEventListener('click', function (e) {
            //if (!document.body.classList.contains('offscreen')) {
            cmdLine_.focus();
            //}
        }, false);

        // Always force text cursor to end of input line.
        cmdLine_.addEventListener('click', inputTextClick_, false);

        // Handle up/down key presses for shell history and enter for new command.
        cmdLine_.addEventListener('keydown', keyboardShortcutHandler_, false);
        cmdLine_.addEventListener('keyup', historyHandler_, false); // keyup needed for input blinker to appear at end of input.
        cmdLine_.addEventListener('keydown', processNewCommand_, false);

        /*window.addEventListener('beforeunload', function(e) {
         return "Don't leave me!";
         }, false);*/

        function inputTextClick_(e) {
            this.value = this.value;
        }

        function keyboardShortcutHandler_(e) {
            // Toggle CRT screen flicker.
            if ((e.ctrlKey || e.metaKey) && e.keyCode == 83) { // crtl+s
                container_.classList.toggle('flicker');
                output('<div>Screen flicker: ' +
                    (container_.classList.contains('flicker') ? 'on' : 'off') +
                    '</div>');
                e.preventDefault();
                e.stopPropagation();
            }
        }

        function selectFile_(el) {
            alert(el)
        }

        function historyHandler_(e) { // Tab needs to be keydown.

            if (history_.length) {
                if (e.keyCode == 38 || e.keyCode == 40) {
                    if (history_[histpos_]) {
                        history_[histpos_] = this.value;
                    } else {
                        histtemp_ = this.value;
                    }
                }

                if (e.keyCode == 38) { // up
                    histpos_--;
                    if (histpos_ < 0) {
                        histpos_ = 0;
                    }
                } else if (e.keyCode == 40) { // down
                    histpos_++;
                    if (histpos_ > history_.length) {
                        histpos_ = history_.length;
                    }
                }

                if (e.keyCode == 38 || e.keyCode == 40) {
                    this.value = history_[histpos_] ? history_[histpos_] : histtemp_;
                    this.value = this.value; // Sets cursor to end of input.
                }
            }
        }

        function processNewCommand_(e) {

            // Beep on backspace and no value on command line.
            if (!this.value && e.keyCode == 8) {
                bell_.stop();
                bell_.play();
                return;
            }

            if (e.keyCode == 9) { // Tab
                e.preventDefault();
                // TODO(ericbidelman): Implement tab suggest.
            } else if (e.keyCode == 13) { // enter

                // Save shell history.
                if (this.value) {
                    history_[history_.length] = this.value;
                    histpos_ = history_.length;
                }

                // Duplicate current input and append to output section.
                var line = this.parentNode.parentNode.cloneNode(true);
                line.removeAttribute('id')
                line.classList.add('line');
                var input = line.querySelector('input.cmdline');
                input.autofocus = false;
                input.readOnly = true;
                output_.appendChild(line);

                // Parse out command, args, and trim off whitespace.
                // TODO(ericbidelman): Support multiple comma separated commands.
                if (this.value && this.value.trim()) {
                    var args = this.value.split(' ').filter(function (val, i) {
                        return val;
                    });
                    var cmd = args[0].toLowerCase();
                    args = args.splice(1); // Remove cmd from arg list.
                }

                switch (cmd) {
                    case '3d':
                        clear_(this);
                        output('Hold on to your butts!');
                        toggle3DView_();
                        break;
                    case 'cat':
                        var fileName = args.join(' ');

                        if (!fileName) {
                            output('usage: ' + cmd + ' filename');
                            break;
                        }

                        read_(cmd, fileName, function (result) {
                            output('<pre>' + result + '</pre>');
                        });

                        break;
                    case 'clear':
                        clear_(this);
                        return;
                    case 'date':
                        output((new Date()).toLocaleString());
                        break;
                    case 'exit':
                        if (is3D_) {
                            toggle3DView_();
                        }
                        if (timer_ != null) {
                            magicWord_.stop();
                            clearInterval(timer_);
                        }
                        break;
                    case 'help':
                        output('<div class="ls-files">' + CMDS_.join('<br>') + '</div>');
                        output('<p>Add files by dragging them from your desktop.</p>');
                        break;
                    case 'install':
                        // Check is installed.
                        if (window.chrome && window.chrome.app) {
                            if (!window.chrome.app.isInstalled) {
                                try {
                                    chrome.app.install();
                                } catch (e) {
                                    alert(e + '\nEnable is about:flags');
                                }
                            } else {
                                output('This app is already installed.');
                            }
                        }
                        break;
                    case 'ls':
                        ls_(function (entries) {
                            if (entries.length) {
                                var html = formatColumns_(entries);
                                util.toArray(entries).forEach(function (entry, i) {
                                    html.push(
                                        '<span class="', entry.isDirectory ? 'folder' : 'file',
                                        '">', entry.name, '</span><br>');
                                });
                                html.push('</div>');
                                output(html.join(''));
                            }
                        });
                        break;
                    case 'pwd':
                        output(cwd_.fullPath);
                        break;
                    case 'cd':
                        var dest = args.join(' ') || '/';

                        cwd_.getDirectory(dest, {}, function (dirEntry) {
                            cwd_ = dirEntry;
                            output('<div>' + dirEntry.fullPath + '</div>');

                            // Tell FSN visualizer that we're cd'ing.
                            if (fsn_) {
                                fsn_.contentWindow.postMessage({cmd: 'cd', data: dest}, location.origin);
                            }

                        }, function (e) {
                            invalidOpForEntryType_(e, cmd, dest);
                        });

                        break;
                    case 'mkdir':
                        var dashP = false;
                        var index = args.indexOf('-p');
                        if (index != -1) {
                            args.splice(index, 1);
                            dashP = true;
                        }

                        if (!args.length) {
                            output('usage: ' + cmd + ' [-p] directory<br>');
                            break;
                        }

                        // Create each directory passed as an argument.
                        args.forEach(function (dirName, i) {
                            if (dashP) {
                                var folders = dirName.split('/');

                                // Throw out './' or '/' if present on the beginning of our path.
                                if (folders[0] == '.' || folders[0] == '') {
                                    folders = folders.slice(1);
                                }

                                createDir_(cwd_, folders);
                            } else {
                                cwd_.getDirectory(dirName, {create: true, exclusive: true}, function () {
                                    // Tell FSN visualizer that we're mkdir'ing.
                                    if (fsn_) {
                                        fsn_.contentWindow.postMessage({cmd: 'mkdir', data: dirName}, location.origin);
                                    }
                                }, function (e) {
                                    invalidOpForEntryType_(e, cmd, dirName);
                                });
                            }
                        });
                        break;
                    case 'cp':
                    case 'mv':
                        var src = args[0];
                        var dest = args[1];

                        if (!src || !dest) {
                            output(['usage: ', cmd, ' source target<br>',
                                '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;', cmd,
                                ' source directory/'].join(''));
                            break;
                        }

                        var runAction = function (cmd, srcDirEntry, destDirEntry, opt_newName) {
                            var newName = opt_newName || null;
                            if (cmd == 'mv') {
                                srcDirEntry.moveTo(destDirEntry, newName);
                            } else {
                                srcDirEntry.copyTo(destDirEntry, newName);
                            }
                        };

                        // Moving to a folder? (e.g. second arg ends in '/').
                        if (dest[dest.length - 1] == '/') {
                            cwd_.getDirectory(src, {}, function (srcDirEntry) {
                                // Create blacklist for dirs we can't re-create.
                                var create = [
                                    '.', './', '..', '../', '/'].indexOf(dest) != -1 ? false : true;

                                cwd_.getDirectory(dest, {create: create}, function (destDirEntry) {
                                    runAction(cmd, srcDirEntry, destDirEntry);
                                }, errorHandler_);
                            }, function (e) {
                                // Try the src entry as a file instead.
                                cwd_.getFile(src, {}, function (srcDirEntry) {
                                    cwd_.getDirectory(dest, {}, function (destDirEntry) {
                                        runAction(cmd, srcDirEntry, destDirEntry);
                                    }, errorHandler_);
                                }, errorHandler_);
                            });
                        } else { // Treat src/destination as files.
                            cwd_.getFile(src, {}, function (srcFileEntry) {
                                srcFileEntry.getParent(function (parentDirEntry) {
                                    runAction(cmd, srcFileEntry, parentDirEntry, dest);
                                }, errorHandler_);
                            }, errorHandler_);
                        }

                        break;
                    case 'open':
                        var fileName = args.join(' ');

                        if (!fileName) {
                            output('usage: ' + cmd + ' filename');
                            break;
                        }

                        open_(cmd, fileName, function (fileEntry) {
                            var myWin = window.open(fileEntry.toURL(), 'mywin');
                        });

                        break;
                    case 'init':
                        if (worker_) {
                            worker_.postMessage({cmd: 'init', type: type_, size: size_});
                        }
                        break;
                    case 'rm':
                        // Remove recursively? If so, remove the flag(s) from the arg list.
                        var recursive = false;
                        ['-r', '-f', '-rf', '-fr'].forEach(function (arg, i) {
                            var index = args.indexOf(arg);
                            if (index != -1) {
                                args.splice(index, 1);
                                recursive = true;
                            }
                        });

                        // Remove each file passed as an argument.
                        args.forEach(function (fileName, i) {
                            cwd_.getFile(fileName, {}, function (fileEntry) {
                                fileEntry.remove(function () {
                                    // Tell FSN visualizer that we're rm'ing.
                                    if (fsn_) {
                                        fsn_.contentWindow.postMessage({cmd: 'rm', data: fileName}, location.origin);
                                    }
                                }, errorHandler_);
                            }, function (e) {
                                if (recursive && e.code == FileError.TYPE_MISMATCH_ERR) {
                                    cwd_.getDirectory(fileName, {}, function (dirEntry) {
                                        dirEntry.removeRecursively(null, errorHandler_);
                                    }, errorHandler_);
                                } else if (e.code == FileError.INVALID_STATE_ERR) {
                                    output(cmd + ': ' + fileName + ': is a directory<br>');
                                } else {
                                    errorHandler_(e);
                                }
                            });
                        });
                        break;
                    case 'rmdir':
                        // Remove each directory passed as an argument.
                        args.forEach(function (dirName, i) {
                            cwd_.getDirectory(dirName, {}, function (dirEntry) {
                                dirEntry.remove(function () {
                                    // Tell FSN visualizer that we're rmdir'ing.
                                    if (fsn_) {
                                        fsn_.contentWindow.postMessage({cmd: 'rm', data: dirName}, location.origin);
                                    }
                                }, function (e) {
                                    if (e.code == FileError.INVALID_MODIFICATION_ERR) {
                                        output(cmd + ': ' + dirName + ': Directory not empty<br>');
                                    } else {
                                        errorHandler_(e);
                                    }
                                });
                            }, function (e) {
                                invalidOpForEntryType_(e, cmd, dirName);
                            });
                        });
                        break;
                    case 'sudo':
                        if (timer_ != null) {
                            magicWord_.stop();
                            clearInterval(timer_);
                        }
                        if (!magicWord_) {
                            magicWord_ = new Sound(true);
                            magicWord_.load('magic_word.mp3', false, function () {
                                magicWord_.play();
                            });
                        } else {
                            magicWord_.play();
                        }
                        timer_ = setInterval(function () {
                            output("<div>YOU DIDN'T SAY THE MAGIC WORD!</div>");
                        }, 100);
                        break;
                    case 'theme':
                        var theme = args.join(' ');
                        if (!theme) {
                            output(['usage: ', cmd, ' ' + THEMES_.join(',')].join(''));
                        } else {
                            if (THEMES_.indexOf(theme) != -1) {
                                setTheme_(theme);
                            } else {
                                output('Error - Unrecognized theme used');
                            }
                        }
                        break;
                    case 'version':
                    case 'ver':
                        output(VERSION_);
                        break;
                    case 'wget':
                        var url = args[0];
                        if (!url) {
                            output(['usage: ', cmd, ' missing URL'].join(''));
                            break;
                        } else if (url.search('^http://') == -1) {
                            url = 'http://' + url;
                        }
                        var xhr = new XMLHttpRequest();
                        xhr.onload = function (e) {
                            if (this.status == 200 && this.readyState == 4) {
                                output('<textarea>' + this.response + '</textarea>');
                            } else {
                                output('ERROR: ' + this.status + ' ' + this.statusText);
                            }
                        };
                        xhr.onerror = function (e) {
                            output('ERROR: ' + this.status + ' ' + this.statusText);
                            output('Could not fetch ' + url);
                        };
                        xhr.open('GET', url, true);
                        xhr.send();
                        break;
                    case 'who':
                        output(document.title +
                            ' - By: Eric Bidelman &lt;ericbidelman@chromium.org&gt;');
                        break;
                    case 'cf':
                        output("<b>NAME</b>:\n" +
                            "<div class='command-help-row'><div>cf - A command line tool to interact with Cloud Foundry</div></div>" +
                            "\n" +
                            "<b>USAGE</b>:\n" +
                            "<div class='command-help-row'><div>[environment variables] cf [global options] command [arguments...] [command options]</div></div>" +
                            "\n" +
                            "<b>VERSION</b>:\n" +
                            "\t6.13.0-e68ce0f-2015-10-15T22:53:29+00:00\n" +
                            "\n" +
                            "<b>BUILD TIME</b>:\n" +
                            "<div class='command-help-row'><div>2015-11-21 19:45:11.113968584 -0500 EST</div></div>" +
                            "\t\n" +
                            "<b>GETTING STARTED</b>:\n" +
                            "<div class='command-help-row'><div>help</div><div>Show help</div></div>" +
                            "<div class='command-help-row'><div>login</div><div>Log user in</div></div>" +
                            "<div class='command-help-row'><div>logout</div><div>Log user out</div></div>" +
                            "<div class='command-help-row'><div>passwd</div><div>Change user password</div></div>" +
                            "<div class='command-help-row'><div>target</div><div>Set or view the targeted org or space</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>api</div><div>Set or view target api url</div></div>" +
                            "<div class='command-help-row'><div>auth</div><div>Authenticate user non-interactively</div></div>" +
                            "\n" +
                            "<b>APPS</b>:\n" +
                            "<div class='command-help-row'><div>apps</div><div>List all apps in the target space</div></div>" +
                            "<div class='command-help-row'><div>app</div><div>Display health and status for app</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>push</div><div>Push a new app or sync changes to an existing app</div></div>" +
                            "<div class='command-help-row'><div>scale</div><div>Change or view the instance count, disk space limit, and memory limit for an app</div></div>" +
                            "<div class='command-help-row'><div>delete</div><div>Delete an app</div></div>" +
                            "<div class='command-help-row'><div>rename</div><div>Rename an app</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>start</div><div>Start an app</div></div>" +
                            "<div class='command-help-row'><div>stop</div><div>Stop an app</div></div>" +
                            "<div class='command-help-row'><div>restart</div><div>Restart an app</div></div>" +
                            "<div class='command-help-row'><div>restage</div><div>Restage an app</div></div>" +
                            "<div class='command-help-row'><div>restart-app-instance</div><div>Terminate the running application Instance at the given index and instantiate a new instance of the application with the same index</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>events</div><div>Show recent app events</div></div>" +
                            "<div class='command-help-row'><div>files</div><div>Print out a list of files in a directory or the contents of a specific file</div></div>" +
                            "<div class='command-help-row'><div>logs</div><div>Tail or show recent logs for an app</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>env</div><div>Show all env variables for an app</div></div>" +
                            "<div class='command-help-row'><div>set-env</div><div>Set an env variable for an app</div></div>" +
                            "<div class='command-help-row'><div>unset-env</div><div>Remove an env variable</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>stacks</div><div>List all stacks (a stack is a pre-built file system, including an operating system, that can run apps)</div></div>" +
                            "<div class='command-help-row'><div>stack</div><div>Show information for a stack (a stack is a pre-built file system, including an operating system, that can run apps)</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>copy-source</div><div>Make a copy of app source code from one application to another.  Unless overridden, the copy-source command will restart the application.</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>create-app-manifest</div><div>Create an app manifest for an app that has been pushed successfully.</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>get-health-check</div><div>get the health_check_type value of an app</div></div>" +
                            "<div class='command-help-row'><div>set-health-check</div><div>set health_check_type flag to either 'port' or 'none'</div></div>" +
                            "<div class='command-help-row'><div>enable-ssh</div><div>enable ssh for the application</div></div>" +
                            "<div class='command-help-row'><div>disable-ssh</div><div>disable ssh for the application</div></div>" +
                            "<div class='command-help-row'><div>ssh-enabled</div><div>Reports whether SSH is enabled on an application container instance</div></div>" +
                            "<div class='command-help-row'><div>ssh</div><div>SSH to an application container instance</div></div>" +
                            "\n" +
                            "<b>SERVICES</b>:\n" +
                            "<div class='command-help-row'><div>marketplace</div><div>List available offerings in the marketplace</div></div>" +
                            "<div class='command-help-row'><div>services</div><div>List all service instances in the target space</div></div>" +
                            "<div class='command-help-row'><div>service</div><div>Show service instance info</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>create-service</div><div>Create a service instance</div></div>" +
                            "<div class='command-help-row'><div>update-service</div><div>Update a service instance</div></div>" +
                            "<div class='command-help-row'><div>delete-service</div><div>Delete a service instance</div></div>" +
                            "<div class='command-help-row'><div>rename-service</div><div>Rename a service instance</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>create-service-key</div><div>Create key for a service instance</div></div>" +
                            "<div class='command-help-row'><div>service-keys</div><div>List keys for a service instance</div></div>" +
                            "<div class='command-help-row'><div>service-key</div><div>Show service key info</div></div>" +
                            "<div class='command-help-row'><div>delete-service-key</div><div>Delete a service key</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>bind-service</div><div>Bind a service instance to an app</div></div>" +
                            "<div class='command-help-row'><div>unbind-service</div><div>Unbind a service instance from an app</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>create-user-provided-service</div><div>Make a user-provided service instance available to cf apps</div></div>" +
                            "<div class='command-help-row'><div>update-user-provided-service</div><div>Update user-provided service instance name value pairs</div></div>" +
                            "\n" +
                            "<b>ORGS</b>:\n" +
                            "<div class='command-help-row'><div>orgs</div><div>List all orgs</div></div>" +
                            "<div class='command-help-row'><div>org</div><div>Show org info</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>create-org</div><div>Create an org</div></div>" +
                            "<div class='command-help-row'><div>delete-org</div><div>Delete an org</div></div>" +
                            "<div class='command-help-row'><div>rename-org</div><div>Rename an org</div></div>" +
                            "\n" +
                            "<b>SPACES</b>:\n" +
                            "<div class='command-help-row'><div>spaces</div><div>List all spaces in an org</div></div>" +
                            "<div class='command-help-row'><div>space</div><div>Show space info</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>create-space</div><div>Create a space</div></div>" +
                            "<div class='command-help-row'><div>delete-space</div><div>Delete a space</div></div>" +
                            "<div class='command-help-row'><div>rename-space</div><div>Rename a space</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>allow-space-ssh</div><div>Allow SSH access for the space</div></div>" +
                            "<div class='command-help-row'><div>disallow-space-ssh</div><div>Disallow SSH access for the space</div></div>" +
                            "<div class='command-help-row'><div>space-ssh-allowed</div><div>Reports whether SSH is allowed in a space</div></div>" +
                            "\n" +
                            "<b>DOMAINS</b>:\n" +
                            "<div class='command-help-row'><div>domains</div><div>List domains in the target org</div></div>" +
                            "<div class='command-help-row'><div>create-domain</div><div>Create a domain in an org for later use</div></div>" +
                            "<div class='command-help-row'><div>delete-domain</div><div>Delete a domain</div></div>" +
                            "<div class='command-help-row'><div>create-shared-domain</div><div>Create a domain that can be used by all orgs (admin-only)</div></div>" +
                            "<div class='command-help-row'><div>delete-shared-domain</div><div>Delete a shared domain</div></div>" +
                            "\n" +
                            "<b>ROUTES</b>:\n" +
                            "<div class='command-help-row'><div>routes</div><div>List all routes in the current space or the current organization</div></div>" +
                            "<div class='command-help-row'><div>create-route</div><div>Create a url route in a space for later use</div></div>" +
                            "<div class='command-help-row'><div>check-route</div><div>Perform a simple check to determine whether a route currently exists or not.</div></div>" +
                            "<div class='command-help-row'><div>map-route</div><div>Add a url route to an app</div></div>" +
                            "<div class='command-help-row'><div>unmap-route</div><div>Remove a url route from an app</div></div>" +
                            "<div class='command-help-row'><div>delete-route</div><div>Delete a route</div></div>" +
                            "<div class='command-help-row'><div>delete-orphaned-routes</div><div>Delete all orphaned routes (e.g.: those that are not mapped to an app)</div></div>" +
                            "\n" +
                            "<b>BUILDPACKS</b>:\n" +
                            "<div class='command-help-row'><div>buildpacks</div><div>List all buildpacks</div></div>" +
                            "<div class='command-help-row'><div>create-buildpack</div><div>Create a buildpack</div></div>" +
                            "<div class='command-help-row'><div>update-buildpack</div><div>Update a buildpack</div></div>" +
                            "<div class='command-help-row'><div>rename-buildpack</div><div>Rename a buildpack</div></div>" +
                            "<div class='command-help-row'><div>delete-buildpack</div><div>Delete a buildpack</div></div>" +
                            "\n" +
                            "<b>USER ADMIN</b>:\n" +
                            "<div class='command-help-row'><div>create-user</div><div>Create a new user</div></div>" +
                            "<div class='command-help-row'><div>delete-user</div><div>Delete a user</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>org-users</div><div>Show org users by role</div></div>" +
                            "<div class='command-help-row'><div>set-org-role</div><div>Assign an org role to a user</div></div>" +
                            "<div class='command-help-row'><div>unset-org-role</div><div>Remove an org role from a user</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>space-users</div><div>Show space users by role</div></div>" +
                            "<div class='command-help-row'><div>set-space-role</div><div>Assign a space role to a user</div></div>" +
                            "<div class='command-help-row'><div>unset-space-role</div><div>Remove a space role from a user</div></div>" +
                            "\n" +
                            "<b>ORG ADMIN</b>:\n" +
                            "<div class='command-help-row'><div>quotas</div><div>List available usage quotas</div></div>" +
                            "<div class='command-help-row'><div>quota</div><div>Show quota info</div></div>" +
                            "<div class='command-help-row'><div>set-quota</div><div>Assign a quota to an org</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>create-quota</div><div>Define a new resource quota</div></div>" +
                            "<div class='command-help-row'><div>delete-quota</div><div>Delete a quota</div></div>" +
                            "<div class='command-help-row'><div>update-quota</div><div>Update an existing resource quota</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>share-private-domain</div><div>Share a private domain with an org</div></div>" +
                            "<div class='command-help-row'><div>unshare-private-domain</div><div>Unshare a private domain with an org</div></div>" +
                            "\n" +
                            "<b>SPACE ADMIN</b>:\n" +
                            "<div class='command-help-row'><div>space-quotas</div><div>List available space resource quotas</div></div>" +
                            "<div class='command-help-row'><div>space-quota</div><div>Show space quota info</div></div>" +
                            "<div class='command-help-row'><div>create-space-quota</div><div>Define a new space resource quota</div></div>" +
                            "<div class='command-help-row'><div>update-space-quota</div><div>update an existing space quota</div></div>" +
                            "<div class='command-help-row'><div>delete-space-quota</div><div>Delete a space quota definition and unassign the space quota from all spaces</div></div>" +
                            "<div class='command-help-row'><div>set-space-quota</div><div>Assign a space quota definition to a space</div></div>" +
                            "<div class='command-help-row'><div>unset-space-quota</div><div>Unassign a quota from a space</div></div>" +
                            "\n" +
                            "<b>SERVICE ADMIN</b>:\n" +
                            "<div class='command-help-row'><div>service-auth-tokens</div><div>List service auth tokens</div></div>" +
                            "<div class='command-help-row'><div>create-service-auth-token</div><div>Create a service auth token</div></div>" +
                            "<div class='command-help-row'><div>update-service-auth-token</div><div>Update a service auth token</div></div>" +
                            "<div class='command-help-row'><div>delete-service-auth-token</div><div>Delete a service auth token</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>service-brokers</div><div>List service brokers</div></div>" +
                            "<div class='command-help-row'><div>create-service-broker</div><div>Create a service broker</div></div>" +
                            "<div class='command-help-row'><div>update-service-broker</div><div>Update a service broker</div></div>" +
                            "<div class='command-help-row'><div>delete-service-broker</div><div>Delete a service broker</div></div>" +
                            "<div class='command-help-row'><div>rename-service-broker</div><div>Rename a service broker</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>migrate-service-instances</div><div>Migrate service instances from one service plan to another</div></div>" +
                            "<div class='command-help-row'><div>purge-service-offering</div><div>Recursively remove a service and child objects from Cloud Foundry database without making requests to a service broker</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>service-access</div><div>List service access settings</div></div>" +
                            "<div class='command-help-row'><div>enable-service-access</div><div>Enable access to a service or service plan for one or all orgs</div></div>" +
                            "<div class='command-help-row'><div>disable-service-access</div><div>Disable access to a service or service plan for one or all orgs</div></div>" +
                            "\n" +
                            "<b>SECURITY GROUP</b>:\n" +
                            "<div class='command-help-row'><div>security-group</div><div>Show a single security group</div></div>" +
                            "<div class='command-help-row'><div>security-groups</div><div>List all security groups</div></div>" +
                            "<div class='command-help-row'><div>create-security-group</div><div>Create a security group</div></div>" +
                            "<div class='command-help-row'><div>update-security-group</div><div>Update a security group</div></div>" +
                            "<div class='command-help-row'><div>delete-security-group</div><div>Deletes a security group</div></div>" +
                            "<div class='command-help-row'><div>bind-security-group</div><div>Bind a security group to a space</div></div>" +
                            "<div class='command-help-row'><div>unbind-security-group</div><div>Unbind a security group from a space</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>bind-staging-security-group</div><div>Bind a security group to the list of security groups to be used for staging applications</div></div>" +
                            "<div class='command-help-row'><div>staging-security-groups</div><div>List security groups in the staging set for applications</div></div>" +
                            "<div class='command-help-row'><div>unbind-staging-security-group</div><div>Unbind a security group from the set of security groups for staging applications</div></div>" +
                            "\n" +
                            "<div class='command-help-row'><div>bind-running-security-group</div><div>Bind a security group to the list of security groups to be used for running applications</div></div>" +
                            "<div class='command-help-row'><div>running-security-groups</div><div>List security groups in the set of security groups for running applications</div></div>" +
                            "<div class='command-help-row'><div>unbind-running-security-group</div><div>Unbind a security group from the set of security groups for running applications</div></div>" +
                            "\n" +
                            "<b>ENVIRONMENT VARIABLE GROUPS</b>:\n" +
                            "<div class='command-help-row'><div>running-environment-variable-group</div><div>Retrieve the contents of the running environment variable group</div></div>" +
                            "<div class='command-help-row'><div>staging-environment-variable-group</div><div>Retrieve the contents of the staging environment variable group</div></div>" +
                            "<div class='command-help-row'><div>set-staging-environment-variable-group</div><div>Pass parameters as JSON to create a staging environment variable group</div></div>" +
                            "<div class='command-help-row'><div>set-running-environment-variable-group</div><div>Pass parameters as JSON to create a running environment variable group</div></div>" +
                            "\n" +
                            "<b>FEATURE FLAGS</b>:\n" +
                            "<div class='command-help-row'><div>feature-flags</div><div>Retrieve list of feature flags with status of each flag-able feature</div></div>" +
                            "<div class='command-help-row'><div>feature-flag</div><div>Retrieve an individual feature flag with status</div></div>" +
                            "<div class='command-help-row'><div>enable-feature-flag</div><div>Enable the use of a feature so that users have access to and can use the feature.</div></div>" +
                            "<div class='command-help-row'><div>disable-feature-flag</div><div>Disable the use of a feature so that users have access to and can use the feature.</div></div>" +
                            "\n" +
                            "<b>ADVANCED</b>:\n" +
                            "<div class='command-help-row'><div>curl</div><div>Executes a raw request, content-type set to application/json by default</div></div>" +
                            "<div class='command-help-row'><div>config</div><div>write default values to the config</div></div>" +
                            "<div class='command-help-row'><div>oauth-token</div><div>Retrieve and display the OAuth token for the current session</div></div>" +
                            "<div class='command-help-row'><div>ssh-code</div><div>Get a one time password for ssh clients</div></div>" +
                            "\n" +
                            "<b>ADD/REMOVE PLUGIN REPOSITORY</b>:\n" +
                            "<div class='command-help-row'><div>add-plugin-repo</div><div>Add a new plugin repository</div></div>" +
                            "<div class='command-help-row'><div>remove-plugin-repo</div><div>Remove a plugin repository</div></div>" +
                            "<div class='command-help-row'><div>list-plugin-repos</div><div>list all the added plugin repository</div></div>" +
                            "<div class='command-help-row'><div>repo-plugins</div><div>List all available plugins in all added repositories</div></div>" +
                            "\n" +
                            "<b>ADD/REMOVE PLUGIN</b>:\n" +
                            "<div class='command-help-row'><div>plugins</div><div>list all available plugin commands</div></div>" +
                            "<div class='command-help-row'><div>install-plugin</div><div>Install the plugin defined in command argument</div></div>" +
                            "<div class='command-help-row'><div>uninstall-plugin</div><div>Uninstall the plugin defined in command argument</div></div>" +
                            "\n" +
                            "<b>INSTALLED PLUGIN COMMANDS</b>:\n" +
                            "<div class='command-help-row'><div>enable-diego</div><div>enable Diego support for an app</div></div>" +
                            "<div class='command-help-row'><div>disable-diego</div><div>disable Diego support for an app</div></div>" +
                            "<div class='command-help-row'><div>has-diego-enabled</div><div>Check if Diego support is enabled for an app</div></div>" +
                            "\n" +
                            "<b>ENVIRONMENT VARIABLES</b>:\n" +
                            "<div class='command-help-row'><div>CF_COLOR=false</div><div>Do not colorize output</div></div>" +
                            "<div class='command-help-row'><div>CF_HOME=path/to/dir/</div><div>Override path to default config directory</div></div>" +
                            "<div class='command-help-row'><div>CF_PLUGIN_HOME=path/to/dir/</div><div>Override path to default plugin config directory</div></div>" +
                            "<div class='command-help-row'><div>CF_STAGING_TIMEOUT=15</div><div>Max wait time for buildpack staging, in minutes</div></div>" +
                            "<div class='command-help-row'><div>CF_STARTUP_TIMEOUT=5</div><div>Max wait time for app instance startup, in minutes</div></div>" +
                            "<div class='command-help-row'><div>CF_TRACE=true</div><div>Print API request diagnostics to stdout</div></div>" +
                            "<div class='command-help-row'><div>CF_TRACE=path/to/trace.log</div><div>Append API request diagnostics to a log file</div></div>" +
                            "<div class='command-help-row'><div>HTTP_PROXY=proxy.example.com:8080</div><div>Enable HTTP proxying for API requests</div></div>" +
                            "\n" +
                            "<b>GLOBAL OPTIONS</b>:\n" +
                            "<div class='command-help-row'><div>--version, -v</div><div>Print the version</div></div>" +
                            "<div class='command-help-row'><div>--build, -b</div><div>Print the version of Go the CLI was built against</div></div>" +
                            "<div class='command-help-row'><div>--help, -h</div><div>Show help</div></div>");
                        break;
                    default:
                        if (cmd) {
                            output(cmd + ': command not found');
                        }
                }
                ;

                this.value = ''; // Clear/setup line for next input.
            }
        }

        function formatColumns_(entries) {
            var maxName = entries[0].name;
            util.toArray(entries).forEach(function (entry, i) {
                if (entry.name.length > maxName.length) {
                    maxName = entry.name;
                }
            });

            // If we have 3 or less entries, shorten the output container's height.
            // 15px height with a monospace font-size of ~12px;
            var height = entries.length == 1 ? 'height: ' + (entries.length * 30) + 'px;' :
                entries.length <= 3 ? 'height: ' + (entries.length * 18) + 'px;' : '';

            // ~12px monospace font yields ~8px screen width.
            var colWidth = maxName.length * 16;//;8;

            return ['<div class="ls-files" style="-webkit-column-width:',
                colWidth, 'px;', height, '">'];
        }

        function invalidOpForEntryType_(e, cmd, dest) {
            if (e.code == FileError.NOT_FOUND_ERR) {
                output(cmd + ': ' + dest + ': No such file or directory<br>');
            } else if (e.code == FileError.INVALID_STATE_ERR) {
                output(cmd + ': ' + dest + ': Not a directory<br>');
            } else if (e.code == FileError.INVALID_MODIFICATION_ERR) {
                output(cmd + ': ' + dest + ': File already exists<br>');
            } else {
                errorHandler_(e);
            }
        }

        function errorHandler_(e) {
            var msg = '';
            switch (e.code) {
                case FileError.QUOTA_EXCEEDED_ERR:
                    msg = 'QUOTA_EXCEEDED_ERR';
                    break;
                case FileError.NOT_FOUND_ERR:
                    msg = 'NOT_FOUND_ERR';
                    break;
                case FileError.SECURITY_ERR:
                    msg = 'SECURITY_ERR';
                    break;
                case FileError.INVALID_MODIFICATION_ERR:
                    msg = 'INVALID_MODIFICATION_ERR';
                    break;
                case FileError.INVALID_STATE_ERR:
                    msg = 'INVALID_STATE_ERR';
                    break;
                default:
                    msg = 'Unknown Error';
                    break;
            }
            ;
            output('<div>Error: ' + msg + '</div>');
        }

        function createDir_(rootDirEntry, folders, opt_errorCallback) {
            var errorCallback = opt_errorCallback || errorHandler_;

            rootDirEntry.getDirectory(folders[0], {create: true}, function (dirEntry) {

                // Recursively add the new subfolder if we still have a subfolder to create.
                if (folders.length) {
                    createDir_(dirEntry, folders.slice(1));
                }
            }, errorCallback);
        }

        function open_(cmd, path, successCallback) {
            if (!fs_) {
                return;
            }

            cwd_.getFile(path, {}, successCallback, function (e) {
                if (e.code == FileError.NOT_FOUND_ERR) {
                    output(cmd + ': ' + path + ': No such file or directory<br>');
                }
            });
        }

        function read_(cmd, path, successCallback) {
            if (!fs_) {
                return;
            }

            cwd_.getFile(path, {}, function (fileEntry) {
                fileEntry.file(function (file) {
                    var reader = new FileReader();

                    reader.onloadend = function (e) {
                        successCallback(this.result);
                    };

                    reader.readAsText(file);
                }, errorHandler_);
            }, function (e) {
                if (e.code == FileError.INVALID_STATE_ERR) {
                    output(cmd + ': ' + path + ': is a directory<br>');
                } else if (e.code == FileError.NOT_FOUND_ERR) {
                    output(cmd + ': ' + path + ': No such file or directory<br>');
                }
            });
        }

        function ls_(successCallback) {
            if (!fs_) {
                return;
            }

            // Read contents of current working directory. According to spec, need to
            // keep calling readEntries() until length of result array is 0. We're
            // guarenteed the same entry won't be returned again.
            var entries = [];
            var reader = cwd_.createReader();

            var readEntries = function () {
                reader.readEntries(function (results) {
                    if (!results.length) {
                        entries = entries.sort();
                        successCallback(entries);
                    } else {
                        entries = entries.concat(util.toArray(results));
                        readEntries();
                    }
                }, errorHandler_);
            };

            readEntries();
        }

        function clear_(input) {
            output_.innerHTML = '';
            input.value = '';
            document.documentElement.style.height = '100%';
            interlace_.style.height = '100%';
        }

        function setTheme_(theme) {
            var currentUrl = document.location.pathname;

            if (!theme || theme == 'default') {
                //history.replaceState({}, '', currentUrl);
                localStorage.removeItem('theme');
                document.body.className = '';
                return;
            }

            if (theme) {
                document.body.classList.add(theme);
                localStorage.theme = theme;
                //history.replaceState({}, '', currentUrl + '#theme=' + theme);
            }
        }

        function toggle3DView_() {
            var body = document.body;
            body.classList.toggle('offscreen');

            is3D_ = !is3D_;

            if (body.classList.contains('offscreen')) {

                container_.style.webkitTransform =
                    'translateY(' + (util.getDocHeight() - 175) + 'px)';

                var transEnd_ = function (e) {
                    var iframe = document.createElement('iframe');
                    iframe.id = 'fsn';
                    iframe.src = '../fsn/fsn_proto.html';

                    fsn_ = body.insertBefore(iframe, body.firstElementChild);

                    iframe.contentWindow.onload = function () {
                        worker_.postMessage({cmd: 'read', type: type_, size: size_});
                    }
                    container_.removeEventListener('webkitTransitionEnd', transEnd_, false);
                };
                container_.addEventListener('webkitTransitionEnd', transEnd_, false);
            } else {
                container_.style.webkitTransform = 'translateY(0)';
                body.removeChild(fsn_);
                fsn_ = null;
            }
        }

        function output(html) {
            html = replaceAll(html, "\n", "<br/>");
            html = replaceAll(html, "\t", "<span class='tab'></span>");
            output_.insertAdjacentHTML('beforeEnd', html);
            //output_.scrollIntoView();
            cmdLine_.scrollIntoView();
        }

        function escapeRegExp(str) {
            return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
        }

        function replaceAll(str, find, replace) {
            return str.replace(new RegExp(escapeRegExp(find), 'g'), replace);
        }

        return {
            initFS: function (persistent, size) {
                output('<div>Welcome to ' + document.title +
                    '! (v' + VERSION_ + ')</div>');
                output((new Date()).toLocaleString());
                output('<p>Documentation: type "help"</p>');

                if (!!!window.requestFileSystem) {
                    output('<div>Sorry! The FileSystem APIs are not available in your browser.</div>');
                    return;
                }

                var type = persistent ? window.PERSISTENT : window.TEMPORARY;
                window.requestFileSystem(type, size, function (filesystem) {
                    fs_ = filesystem;
                    cwd_ = fs_.root;
                    type_ = type;
                    size_ = size;

                    // If we get this far, attempt to create a folder to test if the
                    // --unlimited-quota-for-files fag is set.
                    cwd_.getDirectory('testquotaforfsfolder', {create: true}, function (dirEntry) {
                        dirEntry.remove(function () { // If successfully created, just delete it.
                            // noop.
                        });
                    }, function (e) {
                        if (e.code == FileError.QUOTA_EXCEEDED_ERR) {
                            output('ERROR: Write access to the FileSystem is unavailable.<br>');
                            output('Type "install" or run Chrome with the --unlimited-quota-for-files flag.');
                        } else {
                            errorHandler_(e);
                        }
                    });

                }, errorHandler_);
            },
            output: output,
            setTheme: setTheme_,
            getCmdLine: function () {
                return cmdLine_;
            },
            addDroppedFiles: function (files) {
                util.toArray(files).forEach(function (file, i) {
                    cwd_.getFile(file.name, {create: true, exclusive: true}, function (fileEntry) {

                        // Tell FSN visualizer we've added a file.
                        if (fsn_) {
                            fsn_.contentWindow.postMessage({cmd: 'touch', data: file.name}, location.origin);
                        }

                        fileEntry.createWriter(function (fileWriter) {
                            fileWriter.write(file);
                        }, errorHandler_);
                    }, errorHandler_);
                });
            },
            toggle3DView: toggle3DView_,
            selectFile: selectFile_
        }
    };
