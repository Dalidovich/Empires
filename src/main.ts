import { startApp } from './ui/app';
import './ui/styles.css';

const root = document.getElementById('app');

if (root) {
  void startApp(root);
}
