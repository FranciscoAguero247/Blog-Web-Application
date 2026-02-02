document.addEventListener("DOMContentLoaded", () => {

  // 1. Determine the Theme Route
  let routeSuffix = 'B'; // Default to Batman
  if (document.body.classList.contains('car-theme')) routeSuffix = 'C';
  if (document.body.classList.contains('sw-theme')) routeSuffix = 'S';
  if (document.body.classList.contains('tech-theme')) routeSuffix = 'T';

  // 2. Optimized Cloning & Removal
  const createFormHtml = () => {
    return `
      <div class='post-div-block'>
        <form action='/Isubmit${routeSuffix}' method='POST' id='form-div'>
          <input class='input-form' type='text' name='IndividualBlogPost' placeholder='Type in a post' />
          <button class='button-19 mobile' role='button'><i>Post</i></button>
        </form>
      </div>`;
  };

  $('#cloneButton').on('click', () => {
    $('#container').append(createFormHtml());
  });

  $('#remove-button').on('click', () => {
    $('.internal-blog-post').remove();
    $('#container').append(createFormHtml());
  });

  // 3. Inline Editing Logic (Safe Check)
  const paragraph = document.getElementById("edit");
  const edit_button = document.getElementById("edit-button");
  const end_button = document.getElementById("end-editing");

  if (paragraph && edit_button && end_button) {
    edit_button.addEventListener("click", () => {
      paragraph.contentEditable = true;
      paragraph.style.background = "rgba(255, 255, 255, 0.2)"; // Adjusted for Glassmorphism
      paragraph.focus();
    });

    end_button.addEventListener("click", () => {
      paragraph.contentEditable = false;
      paragraph.style.background = "transparent";
    });
  }

  // 4. Hype Button Animation
  window.triggerHype = function(btn) {
    const countSpan = btn.querySelector('.hype-count');
    if (countSpan) {
      let currentCount = parseInt(countSpan.innerText) || 0;
      countSpan.innerText = currentCount + 1;
      
      // Theme-aware glow
      const glowColor = getComputedStyle(btn).color || "#34efdf";
      btn.style.boxShadow = `0 0 30px ${glowColor}`;
      setTimeout(() => {
        btn.style.boxShadow = "none";
      }, 200);
    }
  };
});