<template>
  <v-app id="app" class="vld-parent">
    <loading
      :active.sync="showBusyIndicator"
      :is-full-page="true"
      :height="64"
      :width="64"
      :color="isLoadingColor"
      background-color="transparent" 
      loader="spinner"
    ></loading>
    
    <v-row class="main-row ma-0 pa-0">
      <v-col class="right-col">
        <v-row class="prompts-col">
          <v-col>
            <Done
              v-if="isDone"
              :doneStatus="doneStatus"
              :doneMessage="doneMessage"
              :donePath="donePath"
            />

            <PromptInfo v-if="currentPrompt && !isDone" :currentPrompt="currentPrompt" />
            <v-slide-x-transition>
              <Form
                ref="form"
                :questions="currentPrompt ? currentPrompt.questions : []"
                @answered="onAnswered"
              />
            </v-slide-x-transition>
          </v-col>
        </v-row>
        <v-divider></v-divider>
        <v-row
          v-if="prompts.length > 0"
          style="height: 4rem; margin: 0"
          sm="auto"
        >
          <v-col class="bottom-buttons-col" style="display:flex;align-items: center;">
            <v-btn id="apply" :disabled="!stepValidated" @click="apply">
              {{messages.applyButton}}
            </v-btn>
          </v-col>
        </v-row>
      </v-col>
    </v-row>

    <!-- TODO Handle scroll of above content when console is visible. low priority because it is for localhost console only -->
    <v-card :class="consoleClass" v-show="showConsole">
      <v-footer absolute class="font-weight-medium" style="max-height: 300px; overflow-y: auto;">
        <v-col class cols="12">
          <div id="logArea" placeholder="No log entry">{{logText}}</div>
        </v-col>
      </v-footer>
    </v-card>
  </v-app>
</template>

<script>
import Vue from "vue";
import Loading from "vue-loading-overlay";
import Done from "./components/Done.vue";
import PromptInfo from "./components/PromptInfo.vue";
import { RpcBrowser } from "@sap-devx/webview-rpc/out.browser/rpc-browser";
import { RpcBrowserWebSockets } from "@sap-devx/webview-rpc/out.browser/rpc-browser-ws";
import * as _ from "lodash";
import FileBrowserPlugin from "@sap-devx/inquirer-gui-file-browser-plugin";
import FolderBrowserPlugin from "@sap-devx/inquirer-gui-folder-browser-plugin";
import LoginPlugin from "@sap-devx/inquirer-gui-login-plugin";
import TilesPlugin from "@sap-devx/inquirer-gui-tiles-plugin";

const FUNCTION = "__Function";
const PENDING = "pending";
const EVALUATING = "evaluating";

function initialState() {
  return {
    generatorName: "",
    generatorPrettyName: "",
    stepValidated: false,
    prompts: [],
    promptIndex: 0,
    rpc: Object,
    resolve: Object,
    reject: Object,
    isDone: false,
    doneMessage: Object,
    doneStatus: false,
    consoleClass: "",
    logText: "",
    showConsole: false,
    messages: {},
    showBusyIndicator: false,
    promptsInfoToDisplay: [],
    numOfSteps: 1,
    code: 'const noop = () => {}',
    originalCode: 'let nuup = () => {}',
    editrOptions: {
      lineNumbers: false,
      renderSideBySide: false
    }
  };
}

export default {
  name: "app",
  components: {
    Done,
    PromptInfo,
    Loading
  },
  data() {
    return initialState();
  },
  computed: {
    isLoadingColor() {
      return (
        getComputedStyle(document.documentElement).getPropertyValue(
          "--vscode-progressBar-background"
        ) || "#0e70c0"
      );
    },
    currentPrompt() {
      return _.get(this.prompts, "[" + this.promptIndex + "]");
    }
  },
  watch: {
    prompts: {
      handler() {
        this.setBusyIndicator();
      }
    },
    "currentPrompt.status": {
      handler() {
        this.setBusyIndicator();
      }
    },
    isDone: {
      handler() {
        this.setBusyIndicator();
      }
    }
  },
  methods: {
    setBusyIndicator() {
      this.showBusyIndicator =
        _.isEmpty(this.prompts) ||
        (this.currentPrompt 
         && (this.currentPrompt.status === PENDING || this.currentPrompt.status === EVALUATING) 
         && !this.isDone);
    },
    apply() {
      if (this.resolve) {
          this.resolve(this.currentPrompt.answers);
      }
    },
    onAnswered(answers, issues) {
      this.stepValidated = issues === undefined;
      const currentPrompt = this.currentPrompt;
      if (currentPrompt) {
        currentPrompt.answers = answers;
        if (currentPrompt.status === EVALUATING) {
          currentPrompt.status = undefined;
        }
      }
    },
    setPromptList(prompts) {
      let promptIndex = this.promptIndex;
      prompts = prompts || [];
      this.promptsInfoToDisplay = _.cloneDeep(prompts);
      // replace all existing prompts except 1st (generator selction) and current prompt
      const startIndex = promptIndex + 1;
      const deleteCount = _.size(this.prompts) - promptIndex;
      const itemsToInsert = prompts.splice(promptIndex, _.size(prompts));
      this.prompts.splice(startIndex, deleteCount, ...itemsToInsert);
    },
    setPrompts(prompts) {
      const firstIncomingPrompt = _.get(prompts, "[0]");
      if (firstIncomingPrompt) {
        let startIndex = this.promptIndex;
        let deleteCount = prompts.length;
        if (!this.currentPrompt || firstIncomingPrompt.status === PENDING) {
          startIndex = this.promptIndex + 1;
          deleteCount = 0;
        }
        this.prompts.splice(startIndex, deleteCount, ...prompts);
      }
    },
    prepQuestions(questions) {
      if (this.currentPrompt) {
        this.currentPrompt.status = EVALUATING;
      }

      for (let question of questions) {
        for (let prop in question) {
          if (question[prop] === FUNCTION) {
            const that = this;
            question[prop] = async (...args) => {
            if (this.currentPrompt) {
              this.currentPrompt.status = EVALUATING;
            }

            try {
              return await that.rpc.invoke("evaluateMethod", [
                args,
                question.name,
                prop
              ]);
            } catch(e) {
              that.showBusyIndicator = false;
              throw(e);
            }};
          }
        }
      }

      if (this.currentPrompt) {
        this.currentPrompt.status = undefined;
      }
    },

    async showPrompt(questions) {
      this.prepQuestions(questions);
      const prompt = this.createPrompt(questions);
      this.setPrompts([prompt]);

      const promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });

      return promise;
    },
    createPrompt(questions) {
      let promptDescription = this.messages.description;
      let promptName = this.messages.title;

      const prompt = Vue.observable({
        questions: questions,
        name: promptName,
        description: promptDescription,
        answers: {},
        active: true,
        status: _.get(this.currentPrompt, "status")
      });
      return prompt;
    },
    log(log) {
      this.logText += log;
      return true;
    },
    snippetDone(succeeded, message, targetPath) {
      this.currentPrompt.name = "Summary";
      this.doneMessage = message;
      this.donePath = targetPath;
      this.doneStatus = succeeded;
      this.isDone = true;
    },
    isInVsCode() {
      return typeof acquireVsCodeApi !== "undefined";
    },
    setupRpc() {
      /* istanbul ignore if */
      if (this.isInVsCode()) {
        // eslint-disable-next-line
        window.vscode = acquireVsCodeApi();
        this.rpc = new RpcBrowser(window, window.vscode);
        this.initRpc();
      } else {
        const ws = new WebSocket("ws://127.0.0.1:8081");
        /* istanbul ignore next */
        ws.onopen = () => {
          this.rpc = new RpcBrowserWebSockets(ws);
          this.initRpc();
        };
      }
    },
    initRpc() {
      const functions = [
        "showPrompt",
        "setPromptList",
        "snippetDone",
        "log"
      ];
      _.forEach(functions, funcName => {
        this.rpc.registerMethod({
          func: this[funcName],
          thisArg: this,
          name: funcName
        });
      });

      this.displayGeneratorsPrompt(); 
    },
    async displayGeneratorsPrompt() {
      await this.setState();
      await this.rpc.invoke("receiveIsWebviewReady", []);
    },
    toggleConsole() {
      this.showConsole = !this.showConsole;
    },

    registerPlugin(plugin) {
      const options = {};
      Vue.use(plugin, options);
      if (options.plugin) {
        const registerPluginFunc = _.get(this.$refs, "form.registerPlugin");
        registerPluginFunc(options.plugin);
      }
    },
    
    init() {
      // register custom inquirer-gui plugins
      this.registerPlugin(FileBrowserPlugin);
      this.registerPlugin(FolderBrowserPlugin);
      this.registerPlugin(LoginPlugin);
      this.registerPlugin(TilesPlugin);

      this.isInVsCode()
        ? (this.consoleClass = "consoleClassHidden")
        : (this.consoleClass = "consoleClassVisible");
    },
    reload() {
      const dataObj = initialState();
      dataObj.rpc = this.rpc;
      Object.assign(this.$data, dataObj);
      this.init();
      
      this.displayGeneratorsPrompt();
    },
    async setState() {
      const uiOptions = await this.rpc.invoke("getState");
      this.messages = uiOptions.messages;
      if (this.isInVsCode()) {
        window.vscode.setState(uiOptions);
      }
    }
  },
  created() {
    this.setupRpc();
  },
  mounted() {
    this.init();
  }
};
</script>
<style scoped>
@import "./../node_modules/vue-loading-overlay/dist/vue-loading.css";
.consoleClassVisible {
  visibility: visible;
}
.consoleClassHidden {
  visibility: hidden;
}
div.consoleClassVisible .v-footer {
  background-color: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-foreground, #cccccc);
}
#logArea {
  font-family: monospace;
  word-wrap: break-word;
  white-space: pre-wrap;
}
.left-col {
  background-color: var(--vscode-editorWidget-background, #252526);
}
.prompts-col {
  overflow-y: auto;
  margin: 0px;
}
.main-row,
.prompts-col {
  height: calc(100% - 4rem);
}
.left-col,
.right-col,
.right-row,
#step-component-div,
#QuestionTypeSelector,
#QuestionTypeSelector > .col,
#QuestionTypeSelector > .col > div {
  height: 100%;
}
.right-col {
  padding: 0 !important;
}
.bottom-buttons-col {
  border-top: 2px solid  var(--vscode-editorWidget-background, #252526);
  padding-right: 25px;
}
.bottom-buttons-col > .v-btn:not(:last-child) {
    margin-right: 10px !important;
}
</style>
