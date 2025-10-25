import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { i18n } from './i18n'
import App from './App.vue';

const app = createApp(App)
const pinia = createPinia()
// Import Element Plus and its styles
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css'; 

app.use(pinia)
app.use(i18n)
app.use(ElementPlus);

app.mount('#app');