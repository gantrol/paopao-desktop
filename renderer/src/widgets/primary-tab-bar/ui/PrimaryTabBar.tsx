import { BubbleMachineIcon, SortingIcon, StreamIcon } from '@/shared/icons/AvatarIcons';

type PrimaryTab = 'chat' | 'sorting' | 'factory';

interface PrimaryTabBarProps {
  activeTab: PrimaryTab;
  showListToggle: boolean;
  isListCollapsed: boolean;
  onSelectChat: () => void;
  onSelectSorting: () => void;
  onSelectFactory: () => void;
  onToggleList: () => void;
}

export function PrimaryTabBar({
  activeTab,
  showListToggle,
  isListCollapsed,
  onSelectChat,
  onSelectSorting,
  onSelectFactory,
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
      <div className={`tab-item tab-item--factory ${activeTab === 'factory' ? 'active' : ''}`} onClick={onSelectFactory}>
        <BubbleMachineIcon className="tab-icon" />
        <span>工厂</span>
      </div>
    </div>
  );
}
