import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AddPopup from './components/AddPopup.tsx';
import BookmarkletPage from './components/BookmarkletPage.tsx';
import './style.css';
import { applyTheme, getTheme } from './theme.tsx';

applyTheme(getTheme());

const route = location.pathname;
const Page = route === '/add' ? AddPopup : route === '/bookmarklet' ? BookmarkletPage : App;

createRoot(document.getElementById('root')!).render(<Page />);
