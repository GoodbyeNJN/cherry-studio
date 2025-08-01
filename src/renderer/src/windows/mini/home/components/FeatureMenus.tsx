import { EnterOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { MiniWindowRoute } from '@renderer/types'
import { Col } from 'antd'
import { FileText, Languages, Lightbulb, MessageSquare } from 'lucide-react'
import { useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface FeatureMenusProps {
  onClick: (route: MiniWindowRoute) => void
}

export interface FeatureMenusRef {
  nextFeature: () => void
  prevFeature: () => void
  useFeature: () => void
  resetSelectedIndex: () => void
}

const FeatureMenus = ({ ref, onClick }: FeatureMenusProps & { ref?: React.RefObject<FeatureMenusRef | null> }) => {
  const { t } = useTranslation()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const features = useMemo(
    () => [
      {
        icon: <MessageSquare size={16} color="var(--color-text)" />,
        title: t('miniwindow.feature.chat'),
        active: true,
        onClick: () => onClick('chat')
      },
      {
        icon: <Languages size={16} color="var(--color-text)" />,
        title: t('miniwindow.feature.translate'),
        onClick: () => onClick('translate')
      },
      {
        icon: <FileText size={16} color="var(--color-text)" />,
        title: t('miniwindow.feature.summary'),
        onClick: () => onClick('summary')
      },
      {
        icon: <Lightbulb size={16} color="var(--color-text)" />,
        title: t('miniwindow.feature.explanation'),
        onClick: () => onClick('explanation')
      }
    ],
    [t, onClick]
  )

  useImperativeHandle(ref, () => ({
    nextFeature() {
      setSelectedIndex((prev) => (prev < features.length - 1 ? prev + 1 : 0))
    },
    prevFeature() {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : features.length - 1))
    },
    useFeature() {
      features[selectedIndex].onClick?.()
    },
    resetSelectedIndex() {
      setSelectedIndex(0)
    }
  }))

  return (
    <FeatureList>
      <FeatureListWrapper>
        {features.map((feature, index) => (
          <Col span={24} key={index}>
            <FeatureItem onClick={feature.onClick} className={index === selectedIndex ? 'active' : ''}>
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <FeatureTitle>{feature.title}</FeatureTitle>
              {index === selectedIndex && <EnterOutlined />}
            </FeatureItem>
          </Col>
        ))}
      </FeatureListWrapper>
    </FeatureList>
  )
}
FeatureMenus.displayName = 'FeatureMenus'

const FeatureList = styled(Scrollbar)`
  flex-shrink: 0;
  height: auto;
  -webkit-app-region: none;
`

const FeatureListWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
`

const FeatureItem = styled.div`
  display: flex;
  flex-direction: row;
  cursor: pointer;
  transition: background-color 0s;
  background: transparent;
  border: none;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  -webkit-app-region: none;
  border-radius: 8px;
  user-select: none;

  &:hover {
    background: var(--color-background-mute);
  }

  &.active {
    background: var(--color-background-mute);
  }
`

const FeatureIcon = styled.div`
  color: #fff;
  display: flex;
`

const FeatureTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  flex-basis: 100%;
`

export default FeatureMenus
