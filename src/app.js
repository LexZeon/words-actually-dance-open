import { AppController } from './app/app-controller.js';

function reportStartupError(error) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = '实验版启动失败，请重新打开。';
    toast.classList.add('visible');
  }
  console.error('Words Actually Dance startup failed:', error);
}

try {
  const app = new AppController();
  app.boot().catch(reportStartupError);
} catch (error) {
  reportStartupError(error);
}
