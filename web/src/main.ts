import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (target === null) {
  throw new Error('index.html is missing the #app element');
}

export default mount(App, { target });
