import { BubbleMachineIcon, SortingIcon, StreamIcon } from '@/shared/icons/AvatarIcons';

type PrimaryTab = 'chat' | 'sorting' | 'factory';

interface PrimaryTabBarProps {
  activeTab: PrimaryTab;
  showListToggle: boolean;
  isListCollapsed: boolean;
  onSelectChat: () => void;
  onSelectSorting: () => void;
  onSelectFactory: () => void;
  onOpenSearch: () => void;
  onToggleList: () => void;
}

export function PrimaryTabBar({
  activeTab,
  showListToggle,
  isListCollapsed,
  onSelectChat,
  onSelectSorting,
  onSelectFactory,
  onOpenSearch,
  onToggleList,
}: PrimaryTabBarProps) {
  return (
    <div className="unified-tab-bar">
      <div className={`tab-item ${activeTab === 'chat' ? 'active' : ''}`} onClick={onSelectChat}>
        <StreamIcon className="tab-icon" />
        <span>如流</span>
      </div>
      <div className={`tab-item ${activeTab === 'sorting' ? 'active' : ''}`} onClick={onSelectSorting}>
        <SortingIcon className="tab-icon" />
        <span>分箱</span>
      </div>
      <button type="button" className="tab-item tab-item--search" onClick={onOpenSearch} aria-label="打开搜索">
        <svg className="tab-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span>搜索</span>
      </button>
      <div className={`tab-item tab-item--factory ${activeTab === 'factory' ? 'active' : ''}`} onClick={onSelectFactory}>
        <BubbleMachineIcon className="tab-icon" />
        <span>工厂</span>
      </div>
    </div>
  );
}
