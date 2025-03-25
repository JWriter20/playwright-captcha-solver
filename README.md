# playwright-captcha-solver
Plugin for playwright designed to solve captchas when they appear


# Steps to complete 
1. Set up mouse cursor for human movements
2. Ensure detection can find all captchas
3. get images of the captchas
4. implement overlays for dragging actions, clicking, or typing actions
5. Implement LLM give feedback on the actions
6. Implement the ability to take the actions


# Final impl:
1. Detect any captcha on the page
2. Get image of the captcha
3. get actions and estimated action locations 
4. Overlay actions on the image
5. Feed image back into LLM to either get next step, adjust action, or confirm the action should be taken
6. take the action - then repeat the process until the captcha is solved. (Some captchas may require multiple steps to solve)




