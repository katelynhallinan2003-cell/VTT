import { render } from 'preact';
import { App } from './ui/App';
import './ui/styles.css';
import { initTheme } from './ui/theme';

initTheme();

render(<App />, document.getElementById('app')!);
