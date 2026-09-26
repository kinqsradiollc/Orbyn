Pod::Spec.new do |s|
  s.name           = 'OrbynCapture'
  s.version        = '1.0.0'
  s.summary        = 'The focus session Live Activity for Orbyn.'
  s.description    = 'Local Expo module: starts, updates and ends the focus session on the Lock Screen and in the Dynamic Island.'
  s.author         = 'Orbyn'
  s.homepage       = 'https://github.com/kinqsradiollc/Orbyn'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
